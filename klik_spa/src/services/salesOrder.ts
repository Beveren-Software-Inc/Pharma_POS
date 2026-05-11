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
