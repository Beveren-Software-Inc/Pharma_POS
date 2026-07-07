import type { SalesInvoice, SalesInvoiceItem } from "../../types";

export type ItemReturnStatus = "none" | "partial" | "full";

export function getItemReturnStatus(item: SalesInvoiceItem): ItemReturnStatus {
  const explicit = (item as SalesInvoiceItem & { return_status?: ItemReturnStatus }).return_status;
  if (explicit === "full" || explicit === "partial" || explicit === "none") {
    return explicit;
  }

  const qty = Number(item.qty ?? item.quantity ?? 0);
  const returned = Number(item.returned_qty ?? 0);
  if (returned <= 0) return "none";
  if (returned >= qty) return "full";
  return "partial";
}

export function getReturnedLineCount(invoice: SalesInvoice): number {
  if (typeof invoice.returnedLineCount === "number" && invoice.returnedLineCount >= 0) {
    return invoice.returnedLineCount;
  }
  return (invoice.items || []).filter((item) => getItemReturnStatus(item) !== "none").length;
}

export function getItemReturnBadgeClass(status: ItemReturnStatus): string {
  const base = "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium";
  switch (status) {
    case "full":
      return `${base} bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300`;
    case "partial":
      return `${base} bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300`;
    default:
      return "";
  }
}

export function getItemReturnLabel(status: ItemReturnStatus): string {
  switch (status) {
    case "full":
      return "Returned";
    case "partial":
      return "Partial return";
    default:
      return "";
  }
}
