import { formatCurrency } from "./currency";
import type { SalesInvoice } from "../../types";

export const fetchLetterHead = async (costCenter: string): Promise<string | null> => {
  if (!costCenter) return null;
  try {
    const res = await fetch(
      `/api/resource/Cost Center/${encodeURIComponent(costCenter)}?fields=["custom_letter_head"]`,
      { credentials: "include" }
    );
    const data = await res.json();
    return data?.data?.custom_letter_head || null;
  } catch {
    return null;
  }
};

export const fetchLetterHeadHtml = async (letterHeadName: string): Promise<string | null> => {
  if (!letterHeadName) return null;
  try {
    const res = await fetch(
      `/api/resource/Letter Head/${encodeURIComponent(letterHeadName)}?fields=["content", "footer"]`,
      { credentials: "include" }
    );
    const data = await res.json();
    return data?.data?.content || null;
  } catch {
    return null;
  }
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function invoicePayments(inv: SalesInvoice): Array<{ method: string; amount: number }> {
  if (Array.isArray(inv.payment_methods) && inv.payment_methods.length > 0) {
    return inv.payment_methods.map((payment) => ({
      method: payment.mode_of_payment || "Unknown",
      amount: Number(payment.amount) || 0,
    }));
  }
  return [{
    method: String(inv.paymentMethod || "Unknown"),
    amount: Number(inv.totalAmount) || 0,
  }];
}

function summarizeInvoices(invoices: SalesInvoice[]) {
  const byUser = new Map<string, { count: number; amount: number }>();
  const byPayment = new Map<string, { count: number; amount: number }>();
  let totalAmount = 0;

  for (const inv of invoices) {
    const cashier = (inv.cashier || "Unknown").trim() || "Unknown";
    const amount = Number(inv.totalAmount) || 0;
    totalAmount += amount;
    const user = byUser.get(cashier) || { count: 0, amount: 0 };
    user.count += 1;
    user.amount += amount;
    byUser.set(cashier, user);

    const payments = invoicePayments(inv);
    const seenMethods = new Set<string>();
    for (const payment of payments) {
      const row = byPayment.get(payment.method) || { count: 0, amount: 0 };
      row.amount += payment.amount;
      if (!seenMethods.has(payment.method)) {
        row.count += 1;
        seenMethods.add(payment.method);
      }
      byPayment.set(payment.method, row);
    }
  }

  return { byUser, byPayment, totalAmount };
}

export interface InvoicePdfMeta {
  title?: string;
  period?: string;
  fromDate?: string;
  toDate?: string;
}

export const exportToCSV = (filteredInvoices: SalesInvoice[]) => {
  const headers = ["Invoice", "Date", "Customer", "Cashier", "Payment", "Amount", "Status"];
  const rows = filteredInvoices.map(inv => [
    inv.id,
    `${inv.date} ${inv.time}`,
    inv.customer,
    inv.cashier || "",
    inv.paymentMethod || "",
    inv.totalAmount,
    inv.status,
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `invoices_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportToPDF = async (
  filteredInvoices: SalesInvoice[],
  currency: string = "USD",
  costCenter?: string | null,
  meta: InvoicePdfMeta = {}
) => {
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

  const reportCurrency = filteredInvoices[0]?.currency || currency;
  const { byUser, byPayment, totalAmount } = summarizeInvoices(filteredInvoices);
  const paymentTotal = [...byPayment.values()].reduce((sum, row) => sum + row.amount, 0);
  const title = meta.title || "Daily Closing Report";
  const period =
    meta.period ||
    (meta.fromDate && meta.toDate
      ? `${meta.fromDate} to ${meta.toDate}`
      : meta.fromDate
        ? `From ${meta.fromDate}`
        : meta.toDate
          ? `Until ${meta.toDate}`
          : "");

  const money = (amount: number, invCurrency?: string) =>
    escapeHtml(formatCurrency(amount, invCurrency || reportCurrency));

  const userRows = [...byUser.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cashier, data]) => `
      <tr>
        <td>${escapeHtml(cashier)}</td>
        <td class="num">${data.count}</td>
        <td class="num">${money(data.amount)}</td>
      </tr>`)
    .join("");

  const paymentRows = [...byPayment.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([method, data]) => `
      <tr>
        <td>${escapeHtml(method)}</td>
        <td class="num">${data.count}</td>
        <td class="num">${money(data.amount)}</td>
      </tr>`)
    .join("");

  const rows = filteredInvoices.map((inv) => {
    const methods = invoicePayments(inv)
      .map((p) => p.method)
      .filter(Boolean);
    const paymentLabel = methods.length ? [...new Set(methods)].join(" / ") : (inv.paymentMethod || "");
    return `
    <tr>
      <td>${escapeHtml(inv.id)}</td>
      <td>${escapeHtml(`${inv.date || ""} ${inv.time || ""}`.trim())}</td>
      <td>${escapeHtml(inv.customer)}</td>
      <td>${escapeHtml(inv.cashier || "")}</td>
      <td>${escapeHtml(paymentLabel)}</td>
      <td class="num">${money(Number(inv.totalAmount) || 0, inv.currency)}</td>
      <td>${escapeHtml(inv.status)}</td>
    </tr>`;
  }).join("");

  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 0; color: #111827; }
          .letter-head { width: 100%; margin-bottom: 16px; }
          .letter-head img { max-width: 100%; }
          .content { padding: 16px; }
          h2 { margin: 0 0 4px; font-size: 18px; }
          h3 { margin: 18px 0 8px; font-size: 13px; }
          .meta { color: #4b5563; margin-bottom: 14px; line-height: 1.5; }
          .summaries { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
          th { background: #f3f4f6; font-weight: bold; }
          tr:nth-child(even) { background: #f9fafb; }
          .num { text-align: right; }
          tfoot td { font-weight: bold; background: #f3f4f6; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .summaries { grid-template-columns: 1fr 1fr; }
          }
        </style>
      </head>
      <body>
        ${letterHeadHtml ? `<div class="letter-head">${letterHeadHtml}</div>` : ""}
        <div class="content">
          <h2>${escapeHtml(title)}</h2>
          <div class="meta">
            ${period ? `<div>Period: ${escapeHtml(period)}</div>` : ""}
            <div>Sales invoices: ${filteredInvoices.length} · Total: ${money(totalAmount)}</div>
            <div>Generated: ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
          <div class="summaries">
            <div>
              <h3>By user</h3>
              <table>
                <thead><tr><th>Cashier</th><th>Invoices</th><th>Amount</th></tr></thead>
                <tbody>${userRows}</tbody>
                <tfoot><tr><td>Total</td><td class="num">${filteredInvoices.length}</td><td class="num">${money(totalAmount)}</td></tr></tfoot>
              </table>
            </div>
            <div>
              <h3>By payment method</h3>
              <table>
                <thead><tr><th>Method</th><th>Invoices</th><th>Amount</th></tr></thead>
                <tbody>${paymentRows}</tbody>
                <tfoot><tr><td>Total</td><td class="num">${filteredInvoices.length}</td><td class="num">${money(paymentTotal)}</td></tr></tfoot>
              </table>
            </div>
          </div>
          <h3>Sales invoices (${filteredInvoices.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Invoice</th><th>Date</th><th>Customer</th>
                <th>Cashier</th><th>Payment</th><th>Amount</th><th>Status</th>
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
};