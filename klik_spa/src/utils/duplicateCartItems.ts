import type { CartItem } from "../../types";

type SerialBatchFlags = {
  has_serial_no?: unknown;
  has_batch_no?: unknown;
  allowDuplicate?: boolean;
};

export function isPosAllowDuplicateItems(
  posDetails: { custom_allow_duplicate_items_in_pos?: unknown } | null | undefined
): boolean {
  const v = posDetails?.custom_allow_duplicate_items_in_pos;
  return v === 1 || v === true || v === "1";
}

export function itemHasSerialOrBatch(item: SerialBatchFlags): boolean {
  const serial = item.has_serial_no;
  const batch = item.has_batch_no;
  return (
    serial === 1 ||
    serial === true ||
    serial === "1" ||
    batch === 1 ||
    batch === true ||
    batch === "1"
  );
}

/** Last cart row for this product (used when clicking the same item again). */
export function findLastCartLineForItem(
  cartItems: CartItem[],
  itemId: string
): CartItem | undefined {
  for (let i = cartItems.length - 1; i >= 0; i--) {
    const line = cartItems[i];
    if (line.id === itemId || line.item_code === itemId) {
      return line;
    }
  }
  return undefined;
}

export function getCartLineUpdateId(item: CartItem): string {
  return (item as { cartLineId?: string }).cartLineId || item.id;
}

export function shouldUseDuplicateCartLines(
  posDetails?: { custom_allow_duplicate_items_in_pos?: unknown } | null,
  item?: SerialBatchFlags
): boolean {
  return isPosAllowDuplicateItems(posDetails) && !!item && itemHasSerialOrBatch(item);
}
