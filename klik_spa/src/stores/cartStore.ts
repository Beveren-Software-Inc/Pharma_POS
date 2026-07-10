import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem, GiftCoupon } from '../../types'
import type { Customer } from '../types/customer'
import type { Patient } from '../services/patientService'
import { toast } from 'react-toastify'
import { clearDraftInvoiceCache } from '../utils/draftInvoiceCache'
import { updateItemPricesForCustomer, getItemPriceForCustomer, applyPricingRulesToCart } from '../services/dynamicPricing'

// Monotonic token to prevent stale async pricing responses from overwriting newer cart state.
let pricingRunToken = 0

function getConversionFactor(item: CartItem): number {
  const cf = Number(item.conversion_factor);
  return Number.isFinite(cf) && cf > 0 ? cf : 1;
}

function getMaxQtyInItemUOM(item: CartItem): number | null {
  const available = item.available;
  if (available === undefined || available === null) return null;
  const cf = getConversionFactor(item);
  console.log(`Calculating max quantity for ${item.name} (available: ${available}, conversion factor: ${cf})`);
  // available is in stock/base UOM; convert to selected item UOM quantity.
  return available / cf;
}

// Preserve batch_no/serial_no from current cart when replacing with merged items (avoids losing them when applyPricingRules runs after scan)
function preserveBatchAndSerial(merged: CartItem[], currentCart: CartItem[]): CartItem[] {
  return merged.map((item) => {
    const lineId = (item as { cartLineId?: string }).cartLineId;
    const current = lineId
      ? currentCart.find((c) => (c as { cartLineId?: string }).cartLineId === lineId)
      : currentCart.find((c) => c.id === item.id && !(c as { cartLineId?: string }).cartLineId);
    if (current && (
      (current as { batch_no?: string }).batch_no != null ||
      (current as { serial_no?: string }).serial_no != null ||
      (current as { dispensing_lot?: string }).dispensing_lot != null
    )) {
      return {
        ...item,
        batch_no: (current as { batch_no?: string }).batch_no,
        serial_no: (current as { serial_no?: string }).serial_no,
        dispensing_lot: (current as { dispensing_lot?: string }).dispensing_lot,
        stock_uom: (current as { stock_uom?: string }).stock_uom,
      };
    }
    return item;
  });
}

// Helper to merge ERPNext pricing rule results (including free items) back into the POS cart
function hasUserEditedRate(item: CartItem): boolean {
  return !!(item as CartItem & { rate_edited?: boolean }).rate_edited;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergePricingResultsWithFreeItems(baseCartItems: CartItem[], pricingResults: any[]): CartItem[] {
  // Update base items with discounts / pricing rule info
  const updatedBaseItems: CartItem[] = baseCartItems.map((item) => {
    if (hasUserEditedRate(item)) {
      return item
    }
    const pricingRuleItem = pricingResults.find((pr) => pr.id === item.id)
    if (!pricingRuleItem) {
      return item
    }

    return {
      ...item,
      price: pricingRuleItem.price ?? item.price,
      // Optional metadata from pricing rules (safe to leave undefined when not present)
      original_price: pricingRuleItem.original_price ?? (item as any).original_price ?? item.price,
      discount_percentage: pricingRuleItem.discount_percentage,
      discount_amount: pricingRuleItem.discount_amount,
      pricing_rules: pricingRuleItem.pricing_rules,
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
  selectedPatient: Patient | null
  /** Points to redeem at checkout (loyalty); null = not redeeming */
  redeemLoyaltyPoints: number | null
  /** General additional amount (e.g. syringe, misc charges) - only when POS allows */
  generalAdditionalAmount: number
  /** Remark for additional amounts (goes to Sales Invoice.custom_remark) */
  additionalRemark: string | null

  // Actions
  /** Returns the newly added cart item when a new line is created (so caller can use cartLineId for quantity/batch). */
  addToCart: (item: Omit<CartItem, 'quantity'>) => Promise<CartItem | void>
  addToCartWithQuantity: (item: Omit<CartItem, 'quantity'>, quantity: number) => Promise<void>
  updateQuantity: (id: string, quantity: number) => Promise<void>
  updateUOM: (id: string, uom: string, price: number, conversionFactor?: number) => Promise<void>
  removeItem: (id: string) => void
  updateItemMetadata: (id: string, updates: Record<string, unknown>) => void
  clearCart: () => void
  applyCoupon: (coupon: GiftCoupon) => void
  removeCoupon: (couponCode: string) => void
  setSelectedCustomer: (customer: Customer | null) => Promise<void>
  setSelectedPatient: (patient: Patient | null) => void
  setRedeemLoyaltyPoints: (points: number | null) => void
  setGeneralAdditionalAmount: (amount: number) => void
  setAdditionalRemark: (remark: string | null) => void
  updatePricesForCustomer: (customerId?: string) => Promise<void>
  applyPricingRules: () => Promise<void>
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cartItems: [],
      appliedCoupons: [],
      selectedCustomer: null,
      selectedPatient: null,
      redeemLoyaltyPoints: null,
      generalAdditionalAmount: 0,
      additionalRemark: null,

      addToCart: async (item) => {
        const state = get();
        // Only merge into an existing line when duplicates are NOT explicitly allowed.
        // For serial / batch-managed items (allowDuplicate=true), always create a new row.
        const existingItem = !item.allowDuplicate
          ? state.cartItems.find((cartItem) => cartItem.id === item.id && !cartItem.allowDuplicate)
          : undefined;

        // Check if item has available quantity
        if (item.available !== undefined && item.available <= 0) {
          toast.error(`${item.name} is out of stock`);
          return;
        }

        if (existingItem) {
          const maxQty = getMaxQtyInItemUOM(existingItem);
          if (maxQty !== null && existingItem.quantity >= maxQty) {
            toast.error(`Only ${maxQty} ${existingItem.uom || item.uom || 'units'} of ${item.name} available`);
            return;
          }

          const lineKey =
            (existingItem as { cartLineId?: string }).cartLineId || existingItem.id;
          set((state) => ({
            cartItems: state.cartItems.map((cartItem) => {
              const key =
                (cartItem as { cartLineId?: string }).cartLineId || cartItem.id;
              return key === lineKey
                ? { ...cartItem, quantity: cartItem.quantity + 1 }
                : cartItem;
            }),
          }));
          return;
        }
        {
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

          const newItem = {
            ...item,
            price: finalPrice,
            quantity: 1,
            cartLineId: item.allowDuplicate
              ? ((item as { cartLineId?: string }).cartLineId || crypto.randomUUID())
              : undefined,
          };
          const newCartItems = [...state.cartItems, newItem];

          set((state) => ({
            cartItems: newCartItems
          }));

          // Apply pricing rules after adding item
          const stateAfterAdd = get();
          if (stateAfterAdd.cartItems.length > 0) {
            await stateAfterAdd.applyPricingRules();
          }
          return newItem;
        }
      },

      addToCartWithQuantity: async (item, quantity) => {
        const state = get();
        const existingItem = !item.allowDuplicate
          ? state.cartItems.find((cartItem) => cartItem.id === item.id && !cartItem.allowDuplicate)
          : undefined;

        // Check if item has available quantity
        const maxQty = getMaxQtyInItemUOM(item as CartItem);
        if (maxQty !== null && maxQty < quantity) {
          toast.error(`Only ${maxQty} ${item.uom || 'units'} of ${item.name} available`);
          return;
        }

        if (existingItem) {
          const maxQty = getMaxQtyInItemUOM(existingItem);
          if (maxQty !== null && (existingItem.quantity + quantity) > maxQty) {
            toast.error(`Only ${maxQty} ${existingItem.uom || item.uom || 'units'} of ${item.name} available`);
            return;
          }

          const lineKey =
            (existingItem as { cartLineId?: string }).cartLineId || existingItem.id;
          set((state) => ({
            cartItems: state.cartItems.map((cartItem) => {
              const key =
                (cartItem as { cartLineId?: string }).cartLineId || cartItem.id;
              return key === lineKey
                ? { ...cartItem, quantity: cartItem.quantity + quantity }
                : cartItem;
            }),
          }));
        } else {
          // New item - fetch correct price if customer is selected (not for pharmacy services)
          let finalPrice = item.price;
          const isPharmacyService = !!(item as CartItem & { is_pharmacy_service?: boolean }).is_pharmacy_service;

          if (state.selectedCustomer && !isPharmacyService) {
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

          const newItem = {
            ...item,
            price: finalPrice,
            quantity,
            cartLineId: item.allowDuplicate
              ? ((item as { cartLineId?: string }).cartLineId || crypto.randomUUID())
              : undefined,
            ...(isPharmacyService && (!finalPrice || finalPrice === 0)
              ? { rate_edited: true as const }
              : {}),
          };
          const newCartItems = [...state.cartItems, newItem];

          set((state) => ({
            cartItems: newCartItems
          }));

          // Apply pricing rules after adding item (skipped for pharmacy-only service lines)
          const stateAfterAdd = get();
          if (stateAfterAdd.cartItems.length > 0 && !isPharmacyService) {
            await stateAfterAdd.applyPricingRules();
          }
          return newItem;
        }
      },

      updateQuantity: async (id, quantity) => {
        const state = get();
        const matchLine = (ci: CartItem) => (ci as { cartLineId?: string }).cartLineId === id || ci.id === id;
        if (quantity <= 0) {
          set({
            cartItems: state.cartItems.filter((item) => !matchLine(item))
          });
          // Apply pricing rules after removing item (quantities changed)
          const stateAfterUpdate = get();
          if (stateAfterUpdate.cartItems.length > 0) {
            await stateAfterUpdate.applyPricingRules();
          }
          return;
        }

        const item = state.cartItems.find(matchLine);
        const maxQty = item ? getMaxQtyInItemUOM(item) : null;
        if (item && maxQty !== null && quantity > maxQty) {
          toast.error(`Only ${maxQty} ${item.uom || 'units'} of ${item.name} available`);
          return;
        }

        set({
          cartItems: state.cartItems.map((item) =>
            matchLine(item) ? { ...item, quantity } : item
          )
        });

        // Apply pricing rules after quantity change (pricing rules can be quantity-based)
        const stateAfterUpdate = get();
        if (stateAfterUpdate.cartItems.length > 0) {
          await stateAfterUpdate.applyPricingRules();
        }
      },

      updateUOM: async (id, uom, price, conversionFactor = 1) => {
        const matchLine = (ci: CartItem) => (ci as { cartLineId?: string }).cartLineId === id || ci.id === id;
        set((state) => {
          const updatedItems = state.cartItems.map((item) => {
            if (matchLine(item)) {
              console.log(`🏪 Cart Store: Item ${id} updated:`, {
                before: { uom: item.uom, price: item.price },
                after: { uom, price }
              });
              return { ...item, uom, price, conversion_factor: conversionFactor };
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

      removeItem: (id) => {
        set((state) => {
          const matchLine = (ci: CartItem) => (ci as { cartLineId?: string }).cartLineId === id || ci.id === id;
          return {
            cartItems: state.cartItems.filter((item) => !matchLine(item))
          };
        });

        // Re-apply pricing rules so dependent free items / discounts are recalculated.
        // Use fire-and-forget to keep remove handler sync for UI callbacks.
        const stateAfterRemove = get();
        if (stateAfterRemove.cartItems.length > 0) {
          void stateAfterRemove.applyPricingRules();
        }
      },

      updateItemMetadata: (id, updates) => set((state) => {
        const matchLine = (ci: CartItem) => (ci as { cartLineId?: string }).cartLineId === id || ci.id === id;
        return {
          cartItems: state.cartItems.map((item) =>
            matchLine(item) ? { ...item, ...updates } : item
          )
        };
      }),

      clearCart: () => {
        // Invalidate any in-flight pricing recalculations started by add/remove/quantity changes.
        // Without this, an async pricing response can finish after clearing and repopulate the cart.
        pricingRunToken += 1

        // Clear draft invoice cache when clearing cart
        clearDraftInvoiceCache();
        set(() => ({
          cartItems: [],
          appliedCoupons: [],
          selectedCustomer: null,
          selectedPatient: null,
          redeemLoyaltyPoints: null,
          generalAdditionalAmount: 0,
          additionalRemark: null,
        }));
      },

      setGeneralAdditionalAmount: (amount) => set(() => ({
        generalAdditionalAmount: Math.max(0, amount)
      })),

      setAdditionalRemark: (remark) => set(() => ({
        additionalRemark: remark && remark.trim().length ? remark.trim() : null,
      })),

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
          ...(customer ? {} : { selectedPatient: null, redeemLoyaltyPoints: null }),
        }));

        // Apply pricing rules when customer changes (pricing rules can be customer-specific)
        const state = get();
        if (state.cartItems.length > 0) {
          await state.updatePricesForCustomer(customer?.id);
        }
      },

      setSelectedPatient: (patient) => set(() => ({ selectedPatient: patient })),

      updatePricesForCustomer: async (customerId) => {
        const state = get();
        if (state.cartItems.length === 0) return;

        // Only apply pricing rules to non-free cart items; free items are re-generated from rules
        const baseCartItems = state.cartItems.filter((item: any) => !item.is_free_item);
        if (baseCartItems.length === 0) {
          set(() => ({ cartItems: [] }));
          return;
        }

        try {
          const runToken = ++pricingRunToken;
          // First get base prices for items
          const priceUpdates = await updateItemPricesForCustomer(baseCartItems, customerId);

          // Update cart items with new base prices, but preserve existing price if UOM is set and price seems correct
          let updatedItems = baseCartItems.map(item => {
            if (hasUserEditedRate(item)) {
              return item;
            }
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

          // Ignore stale async responses if a newer pricing run started.
          if (runToken !== pricingRunToken) return;

          // Merge discounted base items + free items from pricing rules back into the cart
          const mergedCartItems = mergePricingResultsWithFreeItems(updatedItems, itemsWithPricingRules);
          const currentCart = get().cartItems;
          const mergedWithBatch = preserveBatchAndSerial(mergedCartItems, currentCart);

          set(() => ({
            cartItems: mergedWithBatch
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
        if (baseCartItems.length === 0) {
          set(() => ({ cartItems: [] }));
          return;
        }

        try {
          const runToken = ++pricingRunToken;
          const customerId = state.selectedCustomer?.id;
          const itemsWithPricingRules = await applyPricingRulesToCart(baseCartItems, customerId);

          // Ignore stale async responses if a newer pricing run started.
          if (runToken !== pricingRunToken) return;

          const mergedCartItems = mergePricingResultsWithFreeItems(baseCartItems, itemsWithPricingRules);
          const currentCart = get().cartItems;
          const mergedWithBatch = preserveBatchAndSerial(mergedCartItems, currentCart);

          set(() => ({
            cartItems: mergedWithBatch
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

