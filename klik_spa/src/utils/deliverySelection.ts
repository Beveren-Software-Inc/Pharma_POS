/** Same 10% used when the delivery fee is entered, so a resumed hold keeps that tax. */
export const DELIVERY_VAT_RATE = 0.1;

export function deliveryAmountWithVat(amount: number | null | undefined): number | null {
  const fee = Number(amount) || 0;
  if (fee <= 0) return null;
  return Math.round(fee * (1 + DELIVERY_VAT_RATE) * 1000) / 1000;
}

/** Delivery details chosen in the payment screen, kept for the cart Hold action. */
export interface PendingDeliverySelection {
  deliveryPersonnel: string | null;
  deliveryVia: string | null;
  referenceNo: string | null;
  deliveryDistanceKm: number | null;
  deliveryChargeAmount: number;
  deliveryChargeWithVAT?: number | null;
  deliveryRemarks: string | null;
}

let pendingDelivery: PendingDeliverySelection | null = null;

export function setPendingDelivery(selection: PendingDeliverySelection | null): void {
  const hasDetails = Boolean(
    selection &&
      (selection.deliveryPersonnel ||
        selection.deliveryVia ||
        selection.referenceNo ||
        (selection.deliveryChargeAmount || 0) > 0 ||
        selection.deliveryRemarks)
  );
  pendingDelivery = hasDetails ? selection : null;
}

export function getPendingDelivery(): PendingDeliverySelection | null {
  return pendingDelivery;
}

export function clearPendingDelivery(): void {
  pendingDelivery = null;
}
