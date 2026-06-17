import { useCartStore } from '../stores/cartStore';
import type { CartItem, Customer } from '../../types';

export interface DraftLineDiscount {
  discountPercentage: number;
  discountAmount: number;
  batchNumber: string;
  serialNumber: string;
  dispensingLot?: string;
  availableQuantity: number;
  prescriptionDosage?: string;
  dosage?: string;
  medicationOrder?: string;
}

interface DraftInvoiceCache {
  items: CartItem[];
  timestamp: number;
  invoiceId: string;
  customer: Customer | null;
  originalDraftInvoiceId: string;
  lineDiscounts?: Record<string, DraftLineDiscount>;
}

const CACHE_KEY = 'draft-invoice-cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function cacheDraftInvoiceItems(
  invoiceId: string,
  items: CartItem[],
  customer: Customer | null,
  lineDiscounts?: Record<string, DraftLineDiscount>
): void {
  const cache: DraftInvoiceCache = {
    items,
    timestamp: Date.now(),
    invoiceId,
    customer,
    originalDraftInvoiceId: invoiceId,
    lineDiscounts,
  };

  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function getCachedDraftInvoiceItems(): DraftInvoiceCache | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);

    if (!cached) {
      return null;
    }

    const cache: DraftInvoiceCache = JSON.parse(cached);

    const now = Date.now();
    const age = now - cache.timestamp;

    if (age > CACHE_DURATION) {
      clearDraftInvoiceCache();
      return null;
    }

    return cache;
  } catch (error) {
    console.error('Error retrieving cached draft invoice items:', error);
    clearDraftInvoiceCache();
    return null;
  }
}

export function clearDraftInvoiceCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

export async function loadCachedItemsToCart(): Promise<boolean> {
  const cachedData = getCachedDraftInvoiceItems();
  if (!cachedData || cachedData.items.length === 0) {
    return false;
  }

  const { setSelectedCustomer, addToCartWithQuantity } = useCartStore.getState();

  if (cachedData.customer) {
    setSelectedCustomer(cachedData.customer);
  }

  for (const item of cachedData.items) {
    const cartItem = {
      id: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
      image: item.image,
      available: item.available,
      uom: item.uom,
      item_code: item.id,
      allowDuplicate: !!item.cartLineId,
      cartLineId: item.cartLineId,
      batch_no: item.batch_no,
      serial_no: item.serial_no,
      dispensing_lot: item.dispensing_lot,
    };

    await addToCartWithQuantity(cartItem, item.quantity);
  }

  return true;
}

export function getCachedDraftLineDiscounts(): Record<string, DraftLineDiscount> | null {
  const cached = getCachedDraftInvoiceItems();
  return cached?.lineDiscounts || null;
}

export function hasCachedDraftInvoiceItems(): boolean {
  const cached = localStorage.getItem(CACHE_KEY);

  if (!cached) {
    return false;
  }

  try {
    const cache: DraftInvoiceCache = JSON.parse(cached);
    const isValid = Date.now() - cache.timestamp <= CACHE_DURATION;
    return isValid;
  } catch (error) {
    console.error('Error checking cache validity:', error);
    return false;
  }
}

export function getOriginalDraftInvoiceId(): string | null {
  const cachedData = getCachedDraftInvoiceItems();

  return cachedData?.originalDraftInvoiceId || null;
}
