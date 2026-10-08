/** Non-stock item explicitly allowed for sale on this POS. Stock is not required. */
export function isPosServiceItem(item: {
  is_pos_service?: boolean | number | string | null;
} | null | undefined): boolean {
  if (!item) return false;
  return item.is_pos_service === true || item.is_pos_service === 1 || item.is_pos_service === "1";
}
