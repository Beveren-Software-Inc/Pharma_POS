export interface Patient {
  name: string;
  patient_name?: string;
  patient_id?: string;
  file_no?: string;
  /** CPR/Passport/ID Number on Patient (healthcare) */
  id_number?: string;
}

export function getPatientFileNo(patient: Patient): string {
  return (patient.file_no || patient.patient_id || patient.name || "").trim();
}

export function getPatientDisplayName(patient: Patient): string {
  return (patient.patient_name || patient.name || "").trim();
}

export function getPatientSecondaryLabel(patient: Patient): string {
  const fileNo = getPatientFileNo(patient);
  const idNumber = (patient.id_number || "").trim();
  return [
    fileNo ? `File No: ${fileNo}` : "",
    idNumber ? `CPR: ${idNumber}` : "",
  ].filter(Boolean).join(" • ");
}

export interface InpatientMedicationOrderItem {
  drug: string;
  drug_name?: string;
  dosage?: string;
  /** Prescription Frequency name (Link) - use for cart prescription frequency display */
  patient_frequency?: string;
  dosage_form?: string;
  period?: string;
  is_prn?: number | boolean | string;
  medication_type?: string;
  quantity?: number;
  /** UOM from the order entry (e.g. drug default/stock UOM) */
  uom?: string;
  /** Child row name on Patient Medication Order */
  medication_order_entry?: string;
  is_pink?: number | boolean | string;
  reference_no?: string;
  instructions?: string;
  no_of_days?: number | string | null;
  route_of_administration?: string;
  date?: string;
  time?: string;
  end_date?: string;
  alternative_medicine?: string;
  alternative_medicine_name?: string;
  /** Migrated legacy fields from Inpatient Medication Order Entry */
  old_medicine_code?: string;
  old_medicine_name?: string;
  medication?: string;
}

export function resolveMedicationItemCode(item: InpatientMedicationOrderItem): string {
  return (
    item.drug?.trim() ||
    item.alternative_medicine?.trim() ||
    item.old_medicine_code?.trim() ||
    ""
  );
}

export function resolveMedicationDisplayName(item: InpatientMedicationOrderItem): string {
  return (
    item.drug_name?.trim() ||
    item.alternative_medicine_name?.trim() ||
    item.old_medicine_name?.trim() ||
    item.medication?.trim() ||
    resolveMedicationItemCode(item) ||
    "—"
  );
}

export interface InpatientMedicationOrder {
  name: string;
  patient: string;
  patient_name?: string;
  status?: string;
  posting_date?: string;
  healthcare_practitioner?: string;
  healthcare_practitioner_name?: string;
  items: InpatientMedicationOrderItem[];
  custom_reference_type?: string;
  custom_reference_name?: string;
  visit_type?: "OP" | "IP";
  after_discharge?: number | boolean;
}

export interface ItemAlternativeOption {
  item_code: string;
  item_name: string;
  available: number;
}

export async function searchPosStockItemsForAlternative(
  search: string,
  excludeItemCode?: string,
  limit = 50
): Promise<ItemAlternativeOption[]> {
  try {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (excludeItemCode?.trim()) params.set("exclude_item_code", excludeItemCode.trim());
    params.set("limit", String(limit));

    const response = await fetch(
      `/api/method/klik_pos.api.item.search_pos_stock_items_for_alternative?${params.toString()}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to search POS items");
    }
    return Array.isArray(data?.message) ? data.message : [];
  } catch (error) {
    console.error("Error searching POS stock items:", error);
    return [];
  }
}

export async function searchPatients(searchQuery: string): Promise<Patient[]> {
  try {
    const response = await fetch(`/api/method/klik_pos.api.patient.search_patients?search_query=${encodeURIComponent(searchQuery)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to search patients');
    }

    if (data?.message) {
      return data.message;
    }

    return [];
  } catch (error) {
    console.error(`Error searching patients:`, error);
    return [];
  }
}

export async function resolvePatientForCustomer(customerId: string): Promise<Patient | null> {
  if (!customerId?.trim()) return null;
  try {
    const response = await fetch(
      `/api/method/klik_pos.api.patient.resolve_patient_for_customer?customer=${encodeURIComponent(customerId.trim())}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to resolve patient for customer");
    }
    return data?.message || null;
  } catch (error) {
    console.error("Error resolving patient for customer:", error);
    return null;
  }
}

export interface ResolvedCustomer {
  name: string;
  customer_name?: string;
  customer_type?: string;
  default_currency?: string;
}

export async function resolveCustomerForPatient(patientId: string): Promise<ResolvedCustomer | null> {
  if (!patientId?.trim()) return null;
  try {
    const response = await fetch(
      `/api/method/klik_pos.api.patient.resolve_customer_for_patient?patient=${encodeURIComponent(patientId.trim())}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to resolve customer for patient");
    }
    return data?.message || null;
  } catch (error) {
    console.error("Error resolving customer for patient:", error);
    return null;
  }
}

export async function getPrintFormatsForDoctype(
  doctype: string
): Promise<{ formats: string[]; default: string }> {
  if (!doctype?.trim()) return { formats: ["Standard"], default: "Standard" };
  try {
    const response = await fetch(
      `/api/method/klik_pos.api.patient.get_print_formats_for_doctype?doctype=${encodeURIComponent(doctype.trim())}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch print formats");
    }
    const message = data?.message;
    if (message?.formats?.length) {
      return {
        formats: message.formats,
        default: message.default || message.formats[0] || "Standard",
      };
    }
    return { formats: ["Standard"], default: "Standard" };
  } catch (error) {
    console.error("Error fetching print formats:", error);
    return { formats: ["Standard"], default: "Standard" };
  }
}

export async function getPendingInpatientMedicationOrders(patient: string): Promise<InpatientMedicationOrder[]> {
  try {
    const apiUrl = `/api/method/klik_pos.api.patient.get_pending_inpatient_medication_orders?patient=${encodeURIComponent(patient)}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch medication orders');
    }

    if (data?.message) {
      return data.message;
    }

    return [];
  } catch (error) {
    console.error(`Error fetching medication orders:`, error);
    return [];
  }
}

export async function getPatientMedicationOrderHistory(patient: string, limit = 50): Promise<InpatientMedicationOrder[]> {
  try {
    const apiUrl = `/api/method/klik_pos.api.patient.get_patient_medication_order_history?patient=${encodeURIComponent(patient)}&limit=${encodeURIComponent(String(limit))}`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch medication order history');
    }
    return data?.message || [];
  } catch (error) {
    console.error('Error fetching medication order history:', error);
    return [];
  }
}

export interface LegacyDispensedMedicationItem {
  name?: string;
  sr_num?: number | null;
  item?: string;
  item_name?: string;
  item_num?: string;
  show_qty?: number | null;
  show_uom?: string;
  show_rate?: number | null;
  show_amt?: number | null;
  item_expiry_date?: string;
  ais_batch_num?: string;
  trans_remarks_det?: string;
  remarks_detail?: string;
}

export interface LegacyDispensedTransaction {
  name: string;
  trans_no?: string;
  trans_type_num?: string;
  trans_date?: string;
  date_created?: string;
  branch?: string;
  vch_status?: string;
  patient?: string;
  patient_name?: string;
  patient_visit?: string;
  visit_num?: string;
  admission?: string;
  admission_num?: string;
  net_bill_amount?: number | null;
  total_bill_amount?: number | null;
  pink_presc_num?: string;
  trans_remarks?: string;
  item_count?: number;
  items: LegacyDispensedMedicationItem[];
}

export async function getPatientLegacyDispensedMedications(
  patient: string,
  limit = 50
): Promise<LegacyDispensedTransaction[]> {
  try {
    const apiUrl = `/api/method/klik_pos.api.patient.get_patient_legacy_dispensed_medications?patient=${encodeURIComponent(patient)}&limit=${encodeURIComponent(String(limit))}`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch legacy dispensed medications');
    }
    return data?.message || [];
  } catch (error) {
    console.error('Error fetching legacy dispensed medications:', error);
    return [];
  }
}

export interface PatientDiagnosisEntry {
  name: string;
  diagnosis?: string;
  diagnosis_name?: string;
  details?: string;
  posting_date?: string;
  practitioner_name?: string;
  visit_num?: string;
  inpatient_admission?: string;
}

export interface PatientWarningMessage {
  name: string;
  trans_id?: string;
  type_of_warning?: string;
  warning?: string;
  high_risk_text?: string;
  posting_date?: string;
  practitioner_name?: string;
  warning_message_type?: string;
}

export interface PatientUploadDocument {
  name?: string;
  file_name?: string;
  document_name?: string;
  document_type?: string;
  transaction_no?: string;
  upload_remarks?: string;
  document?: string;
}

export interface PatientHistorySummary {
  patient: Record<string, string | number | null | undefined>;
  visits: Array<Record<string, string | number | null | undefined>>;
  medication_orders: InpatientMedicationOrder[];
  diagnosis_entries?: PatientDiagnosisEntry[];
  warning_messages?: PatientWarningMessage[];
  patient_documents?: PatientUploadDocument[];
}

export async function getPatientDocuments(
  customerOrPatient: string,
  opts?: { byCustomer?: boolean }
): Promise<{ patient: string | null; documents: PatientUploadDocument[] }> {
  try {
    const params = new URLSearchParams();
    if (opts?.byCustomer) {
      params.set("customer", customerOrPatient);
    } else {
      params.set("patient", customerOrPatient);
    }
    const response = await fetch(
      `/api/method/klik_pos.api.patient.get_patient_documents?${params.toString()}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch patient documents");
    }
    const message = data?.message;
    if (message?.success === false) {
      throw new Error(message.message || "Failed to fetch patient documents");
    }
    return {
      patient: message?.patient || null,
      documents: message?.patient_documents || [],
    };
  } catch (error) {
    console.error("Error fetching patient documents:", error);
    return { patient: null, documents: [] };
  }
}

export async function getPatientHistorySummary(patient: string, limit = 10): Promise<PatientHistorySummary | null> {
  try {
    const apiUrl = `/api/method/klik_pos.api.patient.get_patient_history_summary?patient=${encodeURIComponent(patient)}&limit=${encodeURIComponent(String(limit))}`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch patient history');
    }
    return data?.message || null;
  } catch (error) {
    console.error('Error fetching patient history summary:', error);
    return null;
  }
}

export async function createPatientVisit(patient: string): Promise<{ doctype: string; name: string; docstatus?: number } | null> {
  try {
    const csrfToken = window.csrf_token;
    const response = await fetch('/api/method/klik_pos.api.patient.create_patient_visit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Frappe-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ patient }),
      credentials: 'include',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to create patient visit');
    }
    return data?.message || null;
  } catch (error) {
    console.error('Error creating patient visit:', error);
    throw error;
  }
}
