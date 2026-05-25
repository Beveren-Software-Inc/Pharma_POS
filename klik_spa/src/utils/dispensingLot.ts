export interface DispensingLotOption {
  name: string;
  serial_no: string;
  remaining_qty: number;
  uom: string;
  stock_uom?: string;
  batch_no?: string;
  label: string;
}

export async function getDispensingLots(
  itemCode: string,
  batchNo?: string
): Promise<DispensingLotOption[]> {
  try {
    const params = new URLSearchParams({ item_code: itemCode });
    if (batchNo) {
      params.set("batch_no", batchNo);
    }
    const res = await fetch(
      `/api/method/klik_pos.api.item.get_dispensing_lots_for_item?${params.toString()}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { message?: DispensingLotOption[] };
    return Array.isArray(data?.message) ? data.message : [];
  } catch {
    return [];
  }
}

/** Show remaining qty prefix when selling in a UOM other than stock (pack) UOM. */
export function formatDispensingLotLabel(
  lot: DispensingLotOption,
  showRemaining: boolean
): string {
  const serial = lot.serial_no || lot.name;
  if (!showRemaining) {
    return serial;
  }
  const qty = lot.remaining_qty;
  const uom = lot.uom || "";
  return uom ? `${qty} ${uom} | ${serial}` : serial;
}

/** Join lot docnames for Sales Invoice Item.custom_dispensing_lot (newline-separated, like serial_no). */
export function joinDispensingLotNames(lotNames: string[]): string {
  return lotNames.map((n) => n.trim()).filter(Boolean).join("\n");
}

export function buildSerialLotMap(
  lots: DispensingLotOption[]
): Record<string, string> {
  const map: Record<string, string> = {};
  lots.forEach((lot) => {
    if (lot.serial_no) {
      map[lot.serial_no] = lot.name;
    }
  });
  return map;
}

/** Cache key for per-item / per-batch dispensing lot lists in POS state. */
export function getDispensingLotCacheKey(
  itemCode: string,
  batchNo?: string
): string {
  const batch = (batchNo || "").trim();
  return batch ? `${itemCode}::${batch}` : itemCode;
}

export function filterLotsByBatch(
  lots: DispensingLotOption[],
  batchNo?: string
): DispensingLotOption[] {
  const batch = (batchNo || "").trim();
  if (!batch) {
    return lots;
  }
  return lots.filter((lot) => (lot.batch_no || "").trim() === batch);
}
