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
  costCenter?: string | null
) => {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  // Fetch letterhead if cost center is provided
  let letterHeadHtml = "";
  if (costCenter) {
    const letterHeadName = await fetchLetterHead(costCenter);
    if (letterHeadName) {
      const html = await fetchLetterHeadHtml(letterHeadName);
      if (html) letterHeadHtml = html;
    }
  }

  const rows = filteredInvoices.map(inv => `
    <tr>
      <td>${inv.id}</td>
      <td>${inv.date} ${inv.time}</td>
      <td>${inv.customer}</td>
      <td>${inv.cashier || ""}</td>
      <td>${inv.paymentMethod || ""}</td>
      <td>${formatCurrency(inv.totalAmount, inv.currency || currency)}</td>
      <td>${inv.status}</td>
    </tr>
  `).join("");

  printWindow.document.write(`
    <html>
      <head>
        <title>Invoices Export</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 0; }
          .letter-head { width: 100%; margin-bottom: 16px; }
          .letter-head img { max-width: 100%; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
          th { background: #f3f4f6; font-weight: bold; }
          tr:nth-child(even) { background: #f9fafb; }
          h2 { margin-bottom: 12px; }
          .content { padding: 16px; }
        </style>
      </head>
      <body>
        ${letterHeadHtml ? `<div class="letter-head">${letterHeadHtml}</div>` : ""}
        <div class="content">
          <h2>Invoices (${filteredInvoices.length})</h2>
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
  printWindow.print();
};