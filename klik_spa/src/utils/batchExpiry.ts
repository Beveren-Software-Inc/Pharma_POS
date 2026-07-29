import { getBatchLabelDetails } from "../services/salesOrder";

/** Default window for “near expiry” warnings (days from today). */
export const NEAR_EXPIRY_DAYS = 90;

export type BatchExpiryStatus = "expired" | "near_expiry" | "ok" | "unknown";

export type CartBatchExpiryLine = {
  itemName: string;
  itemCode: string;
  batchId: string;
  expiryDate?: string | null;
  status: BatchExpiryStatus;
  daysRemaining: number | null;
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse ERPNext / ISO date strings as a local calendar date. */
export function parseExpiryDate(expiry?: string | null): Date | null {
  if (!expiry?.trim()) return null;
  const raw = expiry.trim();
  // Prefer YYYY-MM-DD to avoid timezone shifting the calendar day.
  const isoDay = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDay) {
    const y = Number(isoDay[1]);
    const m = Number(isoDay[2]) - 1;
    const day = Number(isoDay[3]);
    const parsed = new Date(y, m, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

export function daysUntilExpiry(expiry?: string | null, today: Date = new Date()): number | null {
  const expiryDate = parseExpiryDate(expiry);
  if (!expiryDate) return null;
  const ms = startOfDay(expiryDate).getTime() - startOfDay(today).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function getBatchExpiryStatus(
  expiry?: string | null,
  nearExpiryDays: number = NEAR_EXPIRY_DAYS,
  today: Date = new Date()
): BatchExpiryStatus {
  const days = daysUntilExpiry(expiry, today);
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= nearExpiryDays) return "near_expiry";
  return "ok";
}

export function formatBatchExpiryMessage(line: {
  itemName: string;
  batchId: string;
  expiryDate?: string | null;
  status: BatchExpiryStatus;
  daysRemaining: number | null;
}): string {
  const expiryLabel = line.expiryDate?.trim() || "unknown";
  if (line.status === "expired") {
    return `${line.itemName} (batch ${line.batchId}) expired on ${expiryLabel}`;
  }
  if (line.status === "near_expiry") {
    const days =
      line.daysRemaining === null
        ? ""
        : line.daysRemaining === 0
          ? "today"
          : `in ${line.daysRemaining} day${line.daysRemaining === 1 ? "" : "s"}`;
    return `${line.itemName} (batch ${line.batchId}) expires ${days} (${expiryLabel})`;
  }
  return `${line.itemName} (batch ${line.batchId}) expiry ${expiryLabel}`;
}

export function classifyCartBatchLine(args: {
  itemName: string;
  itemCode: string;
  batchId?: string | null;
  expiryDate?: string | null;
  nearExpiryDays?: number;
}): CartBatchExpiryLine | null {
  const batchId = (args.batchId || "").trim();
  if (!batchId) return null;
  const status = getBatchExpiryStatus(args.expiryDate, args.nearExpiryDays);
  return {
    itemName: args.itemName,
    itemCode: args.itemCode,
    batchId,
    expiryDate: args.expiryDate || null,
    status,
    daysRemaining: daysUntilExpiry(args.expiryDate),
  };
}

export async function resolveBatchExpiryDates(
  batchIds: string[]
): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(batchIds.map((b) => b.trim()).filter(Boolean)));
  if (!unique.length) return {};

  const message = await getBatchLabelDetails(unique);
  const out: Record<string, string | null> = {};
  for (const id of unique) {
    out[id] = message[id]?.expiry_date || null;
  }
  return out;
}

export async function auditCartBatchExpiry(
  lines: Array<{
    itemName: string;
    itemCode: string;
    batchId?: string | null;
    expiryHint?: string | null;
  }>,
  nearExpiryDays: number = NEAR_EXPIRY_DAYS
): Promise<{ expired: CartBatchExpiryLine[]; nearExpiry: CartBatchExpiryLine[] }> {
  const withBatch = lines
    .map((line) => ({
      ...line,
      batchId: (line.batchId || "").trim(),
    }))
    .filter((line) => line.batchId);

  const missingExpiry = withBatch
    .filter((line) => !line.expiryHint?.trim())
    .map((line) => line.batchId);
  const fetched = await resolveBatchExpiryDates(missingExpiry);

  const expired: CartBatchExpiryLine[] = [];
  const nearExpiry: CartBatchExpiryLine[] = [];

  for (const line of withBatch) {
    const expiryDate = line.expiryHint?.trim() || fetched[line.batchId] || null;
    const classified = classifyCartBatchLine({
      itemName: line.itemName,
      itemCode: line.itemCode,
      batchId: line.batchId,
      expiryDate,
      nearExpiryDays,
    });
    if (!classified) continue;
    if (classified.status === "expired") expired.push(classified);
    else if (classified.status === "near_expiry") nearExpiry.push(classified);
  }

  return { expired, nearExpiry };
}

/** Toast-friendly copy for selection-time warnings. */
export function selectionExpiryToastCopy(
  itemName: string,
  batchId: string,
  expiry?: string | null
): { status: BatchExpiryStatus; message: string } | null {
  const status = getBatchExpiryStatus(expiry);
  if (status !== "expired" && status !== "near_expiry") return null;
  return {
    status,
    message: formatBatchExpiryMessage({
      itemName,
      batchId,
      expiryDate: expiry,
      status,
      daysRemaining: daysUntilExpiry(expiry),
    }),
  };
}
