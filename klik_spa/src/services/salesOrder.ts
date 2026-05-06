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
