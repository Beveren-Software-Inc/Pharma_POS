import { extractErrorMessage } from "../utils/errorExtraction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createHospitalSalesOrder(data: any) {
  const csrfToken = window.csrf_token;
  const response = await fetch('/api/method/klik_pos.api.sales_order.create_and_submit_hospital_sales_order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ data }),
    credentials: 'include'
  });

  const result = await response.json();
  if (!response.ok || !result.message || result.message.success === false) {
    throw new Error(extractErrorMessage(result, 'Failed to create sales order'));
  }
  return result.message;
}

export async function getBatchLabelDetails(batchNumbers: string[]) {
  if (!Array.isArray(batchNumbers) || batchNumbers.length === 0) {
    return {};
  }

  const csrfToken = window.csrf_token;
  const response = await fetch('/api/method/klik_pos.api.sales_order.get_batch_label_details', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ batch_nos: batchNumbers }),
    credentials: 'include'
  });

  const result = await response.json();
  if (!response.ok || !result?.message) {
    throw new Error(extractErrorMessage(result, 'Failed to fetch batch label details'));
  }

  return result.message as Record<string, { batch_no: string; expiry_date?: string | null }>;
}

export interface DispenseReturnItem {
  item_code: string;
  item_name?: string;
  so_detail?: string;
  dn_detail?: string;
  return_qty: number;
}

export async function createDispenseReturn(
  salesOrderName: string,
  returnItems: DispenseReturnItem[]
) {
  const csrfToken = window.csrf_token;
  const response = await fetch("/api/method/klik_pos.api.sales_order.create_dispense_return", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Frappe-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      sales_order_name: salesOrderName,
      return_items: returnItems,
    }),
    credentials: "include",
  });

  const result = await response.json();
  if (!response.ok || !result.message || result.message.success === false) {
    throw new Error(extractErrorMessage(result, "Failed to create dispense return"));
  }
  return result.message as {
    success: boolean;
    return_delivery_note: string;
    sales_order_name: string;
    delivery_note_name: string;
  };
}
