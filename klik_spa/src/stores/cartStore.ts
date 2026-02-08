import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem, GiftCoupon } from '../../types'
import type { Customer } from '../types/customer'
import { toast } from 'react-toastify'
import { clearDraftInvoiceCache } from '../utils/draftInvoiceCache'
import { updateItemPricesForCustomer, getItemPriceForCustomer, applyPricingRulesToCart } from '../services/dynamicPricing'

// Helper to merge ERPNext pricing rule results (including free items) back into the POS cart
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergePricingResultsWithFreeItems(baseCartItems: CartItem[], pricingResults: any[]): CartItem[] {
  // Update base items with discounts / pricing rule info
  const updatedBaseItems: CartItem[] = baseCartItems.map((item) => {
    const pricingRuleItem = pricingResults.find((pr) => pr.id === item.id)
    if (!pricingRuleItem) {
      return item
    }

    return {
      ...item,
      price: pricingRuleItem.price ?? item.price,
      // Optional metadata from pricing rules (safe to leave undefined when not present)
      // @ts-expect-error: runtime fields from backend
      original_price: pricingRuleItem.original_price ?? (item as any).original_price ?? item.price,
      // @ts-expect-error: runtime fields from backend
      discount_percentage: pricingRuleItem.discount_percentage,
      // @ts-expect-error: runtime fields from backend
      discount_amount: pricingRuleItem.discount_amount,
      // @ts-expect-error: runtime fields from backend
      pricing_rules: pricingRuleItem.pricing_rules,
      // @ts-expect-error: runtime fields from backend
      has_pricing_rule: pricingRuleItem.has_pricing_rule,
    } as CartItem
  })

  // Collect free items from all pricing results
  const freeItems: CartItem[] = []

  pricingResults.forEach((pricingRuleItem) => {
    const freeData = pricingRuleItem.free_item_data
    if (!freeData || !Array.isArray(freeData) || freeData.length === 0) {
      return
    }

    freeData.forEach((fd: any) => {
      const qty = fd.qty || fd.free_qty || 0
      if (!fd.item_code || qty <= 0) {
        return
      }

      freeItems.push({
        id: fd.item_code, // keep id = item_code so invoice builder can use it
        // CartItem core fields
        name: fd.item_name || fd.item_code,
        category: 'Free Item',
        price: fd.rate || 0,
        image: '',
        quantity: qty,
        // Helpful extra fields for backend / UI
        item_code: fd.item_code,
        uom: fd.uom,
        // @ts-expect-error: runtime flag, optional on CartItem
        is_free_item: true,
        // @ts-expect-error: runtime metadata from backend
        pricing_rules: fd.pricing_rules,
      })
    })
  })

  return [...updatedBaseItems, ...freeItems]
}

interface CartState {
  cartItems: CartItem[]
  appliedCoupons: GiftCoupon[]
  selectedCustomer: Customer | null
  /** Points to redeem at checkout (loyalty); null = not redeeming */
  redeemLoyaltyPoints: number | null

  // Actions
  addToCart: (item: Omit<CartItem, 'quantity'>) => Promise<void>
  addToCartWithQuantity: (item: Omit<CartItem, 'quantity'>, quantity: number) => Promise<void>
  updateQuantity: (id: string, quantity: number) => Promise<void>
  updateUOM: (id: string, uom: string, price: number) => Promise<void>
  removeItem: (id: string) => void
  updateItemMetadata: (id: string, updates: Record<string, unknown>) => void
  clearCart: () => void
  applyCoupon: (coupon: GiftCoupon) => void
  removeCoupon: (couponCode: string) => void
  setSelectedCustomer: (customer: Customer | null) => Promise<void>
  setRedeemLoyaltyPoints: (points: number | null) => void
  updatePricesForCustomer: (customerId?: string) => Promise<void>
  applyPricingRules: () => Promise<void>
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cartItems: [],
      appliedCoupons: [],
      selectedCustomer: null,
      redeemLoyaltyPoints: null,

      addToCart: async (item) => {
        const state = get();
        const existingItem = state.cartItems.find((cartItem) => cartItem.id === item.id);

        // Check if item has available quantity
        if (item.available !== undefined && item.available <= 0) {
          toast.error(`${item.name} is out of stock`);
          return;
        }

        if (existingItem) {
          // Check if adding one more would exceed available stock
          if (item.available !== undefined && existingItem.quantity >= item.available) {
            toast.error(`Only ${item.available} ${item.uom || 'units'} of ${item.name} available`);
            return;
          }

          set((state) => ({
            cartItems: state.cartItems.map((cartItem) =>
              cartItem.id === item.id
                ? { ...cartItem, quantity: cartItem.quantity + 1 }
                : cartItem
            )
          }));
        } else {
          // New item - fetch correct price if customer is selected
          let finalPrice = item.price;

          if (state.selectedCustomer) {
            try {
              // Pass the item's UOM to ensure we get the price for the correct UOM
              const priceInfo = await getItemPriceForCustomer(item.id, state.selectedCustomer.id, item.uom);
              if (priceInfo.success) {
                finalPrice = priceInfo.price;
              }
            } catch (error) {
              console.error('❌ Error fetching price for customer:', error);
              // Continue with original price if API fails
            }
          }

          const newCartItems = [...state.cartItems, { ...item, price: finalPrice, quantity: 1 }];

          set((state) => ({
            cartItems: newCartItems
          }));

          // Apply pricing rules after adding item
          const stateAfterAdd = get();
          if (stateAfterAdd.cartItems.length > 0) {
            await stateAfterAdd.applyPricingRules();
          }
        }
      },

      addToCartWithQuantity: async (item, quantity) => {
        const state = get();
        const existingItem = state.cartItems.find((cartItem) => cartItem.id === item.id);

        // Check if item has available quantity
        if (item.available !== undefined && item.available < quantity) {
          toast.error(`Only ${item.available} ${item.uom || 'units'} of ${item.name} available`);
          return;
        }

        if (existingItem) {
          // Check if adding the quantity would exceed available stock
          if (item.available !== undefined && (existingItem.quantity + quantity) > item.available) {
            toast.error(`Only ${item.available} ${item.uom || 'units'} of ${item.name} available`);
            return;
          }

          set((state) => ({
            cartItems: state.cartItems.map((cartItem) =>
              cartItem.id === item.id
                ? { ...cartItem, quantity: cartItem.quantity + quantity }
                : cartItem
            )
          }));
        } else {
          // New item - fetch correct price if customer is selected
          let finalPrice = item.price;

          if (state.selectedCustomer) {
            try {
              // Pass the item's UOM to ensure we get the price for the correct UOM
              const priceInfo = await getItemPriceForCustomer(item.id, state.selectedCustomer.id, item.uom);
              if (priceInfo.success) {
                finalPrice = priceInfo.price;
              }
            } catch (error) {
              console.error('❌ Error fetching price for customer:', error);
              // Continue with original price if API fails
            }
          }

          const newCartItems = [...state.cartItems, { ...item, price: finalPrice, quantity }];

          set((state) => ({
            cartItems: newCartItems
          }));

          // Apply pricing rules after adding item
          const stateAfterAdd = get();
          if (stateAfterAdd.cartItems.length > 0) {
            await stateAfterAdd.applyPricingRules();
          }
        }
      },

      updateQuantity: async (id, quantity) => {
        const state = get();
        if (quantity <= 0) {
          set({
            cartItems: state.cartItems.filter((item) => item.id !== id)
          });
          // Apply pricing rules after removing item (quantities changed)
          const stateAfterUpdate = get();
          if (stateAfterUpdate.cartItems.length > 0) {
            await stateAfterUpdate.applyPricingRules();
          }
          return;
        }

        const item = state.cartItems.find((cartItem) => cartItem.id === id);
        if (item && item.available !== undefined && quantity > item.available) {
          toast.error(`Only ${item.available} ${item.uom || 'units'} of ${item.name} available`);
          return;
        }

        set({
          cartItems: state.cartItems.map((item) =>
            item.id === id ? { ...item, quantity } : item
          )
        });

        // Apply pricing rules after quantity change (pricing rules can be quantity-based)
        const stateAfterUpdate = get();
        if (stateAfterUpdate.cartItems.length > 0) {
          await stateAfterUpdate.applyPricingRules();
        }
      },

      updateUOM: async (id, uom, price) => {
        console.log(`🏪 Cart Store: Updating UOM for item ${id} to ${uom} with price ${price}`);
        set((state) => {
          const updatedItems = state.cartItems.map((item) => {
            if (item.id === id) {
              console.log(`🏪 Cart Store: Item ${id} updated:`, {
                before: { uom: item.uom, price: item.price },
                after: { uom, price }
              });
              return { ...item, uom, price };
            }
            return item;
          });
          console.log(`🏪 Cart Store: All items after update:`, updatedItems);
          return { cartItems: updatedItems };
        });

        // Apply pricing rules after UOM change (pricing rules can be UOM-specific)
        // But preserve the UOM-converted price if it's correct
        const stateAfterUpdate = get();
        if (stateAfterUpdate.cartItems.length > 0) {
          console.log(`🏪 Cart Store: Applying pricing rules after UOM update`);
          await stateAfterUpdate.applyPricingRules();
          const stateAfterPricing = get();
          const updatedItem = stateAfterPricing.cartItems.find(item => item.id === id);
          console.log(`🏪 Cart Store: Item ${id} after pricing rules:`, {
            uom: updatedItem?.uom,
            price: updatedItem?.price
          });
        }
      },

      removeItem: (id) => set((state) => ({
        cartItems: state.cartItems.filter((item) => item.id !== id)
      })),

      updateItemMetadata: (id, updates) => set((state) => ({
        cartItems: state.cartItems.map((item) =>
          item.id === id ? { ...item, ...updates } : item
        )
      })),

      clearCart: () => {
        // Clear draft invoice cache when clearing cart
        clearDraftInvoiceCache();
        set(() => ({
          cartItems: [],
          appliedCoupons: [],
          selectedCustomer: null,
          redeemLoyaltyPoints: null
        }));
      },

      setRedeemLoyaltyPoints: (points) => set(() => ({ redeemLoyaltyPoints: points })),


      applyCoupon: (coupon) => set((state) => {
        if (!state.appliedCoupons.some((c) => c.code === coupon.code)) {
          return {
            appliedCoupons: [...state.appliedCoupons, coupon]
          }
        }
        return state
      }),

      removeCoupon: (couponCode) => set((state) => ({
        appliedCoupons: state.appliedCoupons.filter((coupon) => coupon.code !== couponCode)
      })),

      setSelectedCustomer: async (customer) => {
        set((state) => ({
          selectedCustomer: customer,
          ...(customer ? {} : { redeemLoyaltyPoints: null })
        }));

        // Apply pricing rules when customer changes (pricing rules can be customer-specific)
        const state = get();
        if (state.cartItems.length > 0) {
          await state.updatePricesForCustomer(customer?.id);
        }
      },

      updatePricesForCustomer: async (customerId) => {
        const state = get();
        if (state.cartItems.length === 0) return;

        // Only apply pricing rules to non-free cart items; free items are re-generated from rules
        const baseCartItems = state.cartItems.filter((item: any) => !item.is_free_item);
        if (baseCartItems.length === 0) return;

        try {
          // First get base prices for items
          const priceUpdates = await updateItemPricesForCustomer(baseCartItems, customerId);

          // Update cart items with new base prices, but preserve existing price if UOM is set and price seems correct
          let updatedItems = baseCartItems.map(item => {
            const priceUpdate = priceUpdates[item.id];
            if (priceUpdate && priceUpdate.success && priceUpdate.price > 0) {
              const currentPrice = item.price || 0;
              const newPrice = priceUpdate.price;

              // If item has a UOM and current price > 0, validate if new price makes sense
              // For UOMs with conversion factors, the price should be base_price * conversion_factor
              // If current price is much higher than new price and UOM is set, it might be a calculated price
              if (item.uom && currentPrice > 0) {
                // If new price is much lower than current (less than 50% of current),
                // and current price is reasonable (> 0), preserve current price
                // This handles cases where Box (360) is being overwritten with Nos (18)
                if (newPrice < currentPrice * 0.5 && currentPrice > 10) {
                  console.log(`Preserving price for ${item.id}: current=${currentPrice}, new=${newPrice}, UOM=${item.uom}`);
                  return item; // Keep existing price - it's likely a UOM-converted price
                }
              }

              return { ...item, price: newPrice };
            }
            return item;
          });

          // Then apply pricing rules to get discounted prices
          const itemsWithPricingRules = await applyPricingRulesToCart(updatedItems, customerId);

          // Merge discounted base items + free items from pricing rules back into the cart
          const mergedCartItems = mergePricingResultsWithFreeItems(updatedItems, itemsWithPricingRules);

          set(() => ({
            cartItems: mergedCartItems
          }));

        } catch (error) {
          console.error('❌ Error updating prices for customer:', error);
          toast.error('Failed to update prices for customer');
        }
      },

      applyPricingRules: async () => {
        const state = get();
        if (state.cartItems.length === 0) return;

        // Only price non-free items; free items are derived from rules
        const baseCartItems = state.cartItems.filter((item: any) => !item.is_free_item);
        if (baseCartItems.length === 0) return;

        try {
          const customerId = state.selectedCustomer?.id;
          const itemsWithPricingRules = await applyPricingRulesToCart(baseCartItems, customerId);

          const mergedCartItems = mergePricingResultsWithFreeItems(baseCartItems, itemsWithPricingRules);

          set(() => ({
            cartItems: mergedCartItems
          }));
        } catch (error) {
          console.error('❌ Error applying pricing rules:', error);
        }
      }
    }),
    {
      name: 'beveren-cart-storage'
    }
  )
)
