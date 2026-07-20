import { useCartStore } from "../stores/cartStore";
import type { CartItem } from "../../types";
import type { Customer } from "../types/customer";
import type { Patient } from "../services/patientService";
import type { DraftLineDiscount } from "./draftInvoiceCache";

interface HeldDispenseOrderCache {
  items: CartItem[];
  timestamp: number;
  salesOrderId: string;
  customer: Customer | null;
  patient: Patient | null;
  lineDiscounts?: Record<string, DraftLineDiscount>;
  dispenseRemarks?: string;
  createdVisitRef?: { doctype: string; name: string; visit_type?: string | null } | null;
}

const CACHE_KEY = "held-dispense-order-cache";
const CACHE_DURATION = 30 * 60 * 1000;

export function cacheHeldDispenseOrder(data: HeldDispenseOrderCache): void {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      ...data,
      timestamp: Date.now(),
    })
  );
}

export function getCachedHeldDispenseOrder(): HeldDispenseOrderCache | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const parsed: HeldDispenseOrderCache = JSON.parse(cached);
    if (Date.now() - (parsed.timestamp || 0) > CACHE_DURATION) {
      clearHeldDispenseOrderCache();
      return null;
    }
    return parsed;
  } catch {
    clearHeldDispenseOrderCache();
    return null;
  }
}

export function clearHeldDispenseOrderCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

export function hasCachedHeldDispenseOrder(): boolean {
  return !!getCachedHeldDispenseOrder();
}

export function getOriginalHeldDispenseOrderId(): string | null {
  return getCachedHeldDispenseOrder()?.salesOrderId || null;
}

export function getCachedHeldDispenseLineDiscounts(): Record<string, DraftLineDiscount> | null {
  return getCachedHeldDispenseOrder()?.lineDiscounts || null;
}

export async function loadCachedHeldDispenseToCart(): Promise<boolean> {
  const cached = getCachedHeldDispenseOrder();
  if (!cached?.items?.length) return false;

  const { setSelectedCustomer, setSelectedPatient, addToCartWithQuantity } = useCartStore.getState();

  if (cached.customer) {
    await setSelectedCustomer(cached.customer);
  }
  if (cached.patient) {
    setSelectedPatient(cached.patient);
  }

  for (const item of cached.items) {
    await addToCartWithQuantity(
      {
        id: item.id,
        name: item.name,
        category: item.category,
        price: item.price,
        image: item.image,
        available: item.available,
        uom: item.uom,
        item_code: item.item_code || item.id,
        allowDuplicate: !!item.cartLineId,
        cartLineId: item.cartLineId,
        batch_no: item.batch_no,
        serial_no: item.serial_no,
        dispensing_lot: item.dispensing_lot,
      },
      item.quantity
    );
  }

  return true;
}
