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

export function shouldUseDuplicateCartLines(
  _posDetails?: { custom_allow_duplicate_items_in_pos?: unknown } | null,
  _item?: SerialBatchFlags
): boolean {
  return true;
}
