import { fetchLetterHead, fetchLetterHeadHtml } from "./exportInvoice";
import { getExportFilename } from "./exportUtils";
import type { SalesInvoice } from "../../types";
import type {
  LegacyDispensedTransaction,
  PosDispensedTransaction,
} from "../services/patientService";
import {
  resolveLegacyMedicationDisplayName,
  resolveLegacyMedicationItemCode,
  resolvePosDispensedDisplayName,
  resolvePosDispensedItemCode,
} from "../services/patientService";

export interface DispenseReportLine {
  date: string;
  order: string;
  patient: string;
  source: string;
  medicine: string;
  itemCode: string;
  qty: string;
  uom: string;
  batch: string;
  status: string;
  cashier: string;
}

export interface DispenseReportMeta {
  title?: string;
  patientName?: string;
  fromDate?: string;
  toDate?: string;
  generatedAt?: string;
}

const REPORT_HEADERS = [
  "Date",
  "Order",
  "Patient",
  "Source",
  "Medicine",
  "Item Code",
  "Qty",
  "UOM",
  "Batch",
  "Status",
  "Cashier",
] as const;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function sliceDate(value?: string | null): string {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function formatQty(value: unknown): string {
  if (value == null || value === "") return "";
  const num = Number(value);
  if (Number.isFinite(num)) return String(num);
  return String(value);
}

export function invoicesToDispenseReportLines(invoices: SalesInvoice[]): DispenseReportLine[] {
  const lines: DispenseReportLine[] = [];
  for (const invoice of invoices) {
    const items = invoice.items || [];
    const base = {
      date: sliceDate(invoice.date || invoice.posting_date) || String(invoice.date || ""),
      order: invoice.id || invoice.name || "",
      patient: invoice.customer || "",
      source: "POS",
      status: invoice.status || "",
      cashier: invoice.cashier || "",
    };
    if (items.length === 0) {
      lines.push({
        ...base,
        medicine: "",
        itemCode: "",
        qty: "",
        uom: "",
        batch: "",
      });
      continue;
    }
    for (const item of items) {
      lines.push({
        ...base,
        medicine: item.item_name || item.name || "",
        itemCode: item.item_code || item.id || "",
        qty: formatQty(item.qty ?? item.quantity),
        uom: item.uom || "",
        batch: item.batch_no || "",
      });
    }
  }
  return lines;
}

export function patientDispensesToReportLines(opts: {
  pos?: PosDispensedTransaction[];
  legacy?: LegacyDispensedTransaction[];
}): DispenseReportLine[] {
  const lines: DispenseReportLine[] = [];

  for (const txn of opts.pos || []) {
    const base = {
      date: sliceDate(txn.transaction_date),
      order: txn.name,
      patient: txn.customer_name || txn.customer || txn.patient || "",
      source: "POS",
      status: txn.status || "Dispensed",
      cashier: "",
    };
    const items = txn.items || [];
    if (items.length === 0) {
      lines.push({ ...base, medicine: "", itemCode: "", qty: "", uom: "", batch: "" });
      continue;
    }
    for (const item of items) {
      lines.push({
        ...base,
        medicine: resolvePosDispensedDisplayName(item),
        itemCode: resolvePosDispensedItemCode(item),
        qty: formatQty(item.qty),
        uom: item.uom || "",
        batch: item.batch_no || "",
      });
    }
  }

  for (const txn of opts.legacy || []) {
    const base = {
      date: sliceDate(txn.trans_date || txn.date_created),
      order: txn.trans_no || txn.name,
      patient: txn.patient_name || txn.patient || "",
      source: "Legacy",
      status: txn.vch_status || "Dispensed",
      cashier: "",
    };
    const items = txn.items || [];
    if (items.length === 0) {
      lines.push({ ...base, medicine: "", itemCode: "", qty: "", uom: "", batch: "" });
      continue;
    }
    for (const item of items) {
      lines.push({
        ...base,
        medicine: resolveLegacyMedicationDisplayName(item),
        itemCode: resolveLegacyMedicationItemCode(item),
        qty: formatQty(item.show_qty),
        uom: item.show_uom || "",
        batch: item.ais_batch_num || "",
      });
    }
  }

  lines.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.order || "").localeCompare(a.order || ""));
  return lines;
}

function rangeLabel(meta?: DispenseReportMeta): string {
  if (meta?.fromDate && meta?.toDate) return `${meta.fromDate} to ${meta.toDate}`;
  if (meta?.fromDate) return `From ${meta.fromDate}`;
  if (meta?.toDate) return `Until ${meta.toDate}`;
  return "All time";
}

export function exportDispenseHistoryToCSV(
  lines: DispenseReportLine[],
  filenamePrefix = "dispensed_history"
): void {
  if (!lines.length) {
    throw new Error("No dispensed medicine to export");
  }

  const csvContent = [
    REPORT_HEADERS.join(","),
    ...lines.map((line) =>
      [
        line.date,
        line.order,
        line.patient,
        line.source,
        line.medicine,
        line.itemCode,
        line.qty,
        line.uom,
        line.batch,
        line.status,
        line.cashier,
      ]
        .map(escapeCsv)
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getExportFilename(filenamePrefix, "csv");
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportDispenseHistoryToPDF(
  lines: DispenseReportLine[],
  meta: DispenseReportMeta = {},
  costCenter?: string | null
): Promise<void> {
  if (!lines.length) {
    throw new Error("No dispensed medicine to print");
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Unable to open print window. Please allow pop-ups and try again.");
  }

  let letterHeadHtml = "";
  if (costCenter) {
    const letterHeadName = await fetchLetterHead(costCenter);
    if (letterHeadName) {
      const html = await fetchLetterHeadHtml(letterHeadName);
      if (html) letterHeadHtml = html;
    }
  }

  const title = meta.title || "Dispensed Medicine Report";
  const generatedAt = meta.generatedAt || new Date().toLocaleString();
  const showCashier = lines.some((line) => line.cashier);
  const rows = lines
    .map(
      (line) => `
      <tr>
        <td>${escapeHtml(line.date)}</td>
        <td>${escapeHtml(line.order)}</td>
        <td>${escapeHtml(line.patient)}</td>
        <td>${escapeHtml(line.source)}</td>
        <td>${escapeHtml(line.medicine)}</td>
        <td>${escapeHtml(line.itemCode)}</td>
        <td class="num">${escapeHtml(line.qty)}</td>
        <td>${escapeHtml(line.uom)}</td>
        <td>${escapeHtml(line.batch)}</td>
        <td>${escapeHtml(line.status)}</td>
        ${showCashier ? `<td>${escapeHtml(line.cashier)}</td>` : ""}
      </tr>`
    )
    .join("");

  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; padding: 0; color: #111827; }
          .letter-head { width: 100%; margin-bottom: 12px; }
          .letter-head img { max-width: 100%; }
          .content { padding: 16px; }
          h2 { margin: 0 0 4px; font-size: 18px; }
          .meta { color: #4b5563; margin-bottom: 14px; line-height: 1.5; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #d1d5db; padding: 5px 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; font-size: 10px; text-transform: uppercase; }
          tr:nth-child(even) { background: #f9fafb; }
          .num { text-align: right; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        ${letterHeadHtml ? `<div class="letter-head">${letterHeadHtml}</div>` : ""}
        <div class="content">
          <h2>${escapeHtml(title)}</h2>
          <div class="meta">
            ${meta.patientName ? `<div>Patient: <strong>${escapeHtml(meta.patientName)}</strong></div>` : ""}
            <div>Period: ${escapeHtml(rangeLabel(meta))}</div>
            <div>Lines: ${lines.length} · Generated: ${escapeHtml(generatedAt)}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Order</th>
                <th>Patient</th>
                <th>Source</th>
                <th>Medicine</th>
                <th>Item Code</th>
                <th>Qty</th>
                <th>UOM</th>
                <th>Batch</th>
                <th>Status</th>
                ${showCashier ? "<th>Cashier</th>" : ""}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
