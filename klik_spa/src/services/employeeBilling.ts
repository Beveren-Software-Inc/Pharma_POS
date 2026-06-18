import { extractErrorMessage } from "../utils/errorExtraction";

export interface EmployeeOption {
  name: string;
  employee_name?: string;
  company?: string;
  department?: string;
  designation?: string;
}

export async function searchEmployees(searchQuery = '', limit = 20): Promise<EmployeeOption[]> {
  const params = new URLSearchParams({
    search_query: searchQuery,
    limit: String(limit),
  });
  const response = await fetch(
    `/api/method/klik_pos.api.employee_billing.search_employees?${params.toString()}`,
    { credentials: 'include' }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to search employees');
  }
  return data?.message || [];
}

export async function createEmployeeDispenseInvoice(payload: {
  employee: string;
  items: Array<Record<string, unknown>>;
  company?: string;
  cost_center?: string;
  patient?: string;
}): Promise<{
  name: string;
  customer?: string;
  grand_total?: number;
  sales_order_name?: string;
  delivery_note_name?: string;
  sales_invoice_name?: string;
  invoice_created?: boolean;
}> {
  const csrfToken = window.csrf_token;
  const response = await fetch('/api/method/klik_pos.api.employee_billing.create_employee_dispense_invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ data: payload }),
    credentials: 'include',
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, 'Failed to dispense to employee'));
  }
  return data?.message || data;
}
