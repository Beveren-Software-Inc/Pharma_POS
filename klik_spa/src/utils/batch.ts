export interface BatchStockOption {
  batch_id: string;
  qty: number;
  expiry_date?: string | null;
  /** Original manufacturing lot (custom_original_batch_id). When the same GS1 lot is
   *  reused across different items, beveren_health creates an item-unique batch with
   *  batch_id = `ORIGINAL_ITEMCODE` and original_batch_id = the scanned lot. */
  original_batch_id?: string | null;
}

const batchListCache = new Map<string, BatchStockOption[]>();

export function itemHasBatchNo(item: { has_batch_no?: unknown }): boolean {
  const value = item.has_batch_no;
  return value === 1 || value === true || value === "1";
}

export function formatBatchExpiryLabel(expiry?: string | null): string | null {
  if (!expiry?.trim()) return null;
  const parsed = new Date(expiry);
  if (Number.isNaN(parsed.getTime())) return expiry.trim();
  return parsed.toLocaleDateString();
}

export async function getBatches(itemCode: string): Promise<BatchStockOption[]> {
  const response = await fetch(
    `/api/method/klik_pos.api.item.get_batch_nos_with_qty?item_code=${encodeURIComponent(itemCode)}`
  );
  const resData = await response.json();
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as BatchStockOption[];
  }

  throw new Error("Invalid response format");
}

export async function getBatchesCached(itemCode: string): Promise<BatchStockOption[]> {
  const cached = batchListCache.get(itemCode);
  if (cached) return cached;

  const batches = await getBatches(itemCode);
  batchListCache.set(itemCode, batches);
  return batches;
}

export function clearBatchListCache(itemCode?: string) {
  if (itemCode) {
    batchListCache.delete(itemCode);
    return;
  }
  batchListCache.clear();
}
