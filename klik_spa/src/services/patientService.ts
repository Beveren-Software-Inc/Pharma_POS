export interface Patient {
  name: string;
  patient_name?: string;
  patient_id?: string;
  file_no?: string;
  /** CPR/Passport/ID Number on Patient (healthcare) */
  id_number?: string;
  mobile?: string;
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
  const mobile = (patient.mobile || "").trim();
  return [
    fileNo ? `File No: ${fileNo}` : "",
    idNumber ? `CPR: ${idNumber}` : "",
    mobile ? `Mobile: ${mobile}` : "",
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

export async function getPendingInpatientMedicationOrders(
  patient: string,
  opts?: { includeUnsigned?: boolean }
): Promise<InpatientMedicationOrder[]> {
  try {
    const params = new URLSearchParams();
    params.set("patient", patient);
    if (opts?.includeUnsigned) {
      params.set("include_unsigned", "1");
    }
    const apiUrl = `/api/method/klik_pos.api.patient.get_pending_inpatient_medication_orders?${params.toString()}`;

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

/** Legacy sales line → best-effort item code (often not a current Item). */
export function resolveLegacyMedicationItemCode(item: LegacyDispensedMedicationItem): string {
  return (item.item_num || item.item || "").trim();
}

export function resolveLegacyMedicationDisplayName(item: LegacyDispensedMedicationItem): string {
  return (
    item.item_name?.trim() ||
    item.item?.trim() ||
    item.item_num?.trim() ||
    "—"
  );
}

export function dispensedMedicationLineKey(
  source: "legacy" | "pos",
  txnName: string,
  idx: number,
  code: string
): string {
  return `${source}::${txnName}::${idx}::${code}`;
}

export function legacyMedicationLineKey(
  txnName: string,
  idx: number,
  item: LegacyDispensedMedicationItem
): string {
  const code = resolveLegacyMedicationItemCode(item) || item.name || String(idx);
  return dispensedMedicationLineKey("legacy", txnName, idx, code);
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

export interface PosDispensedMedicationItem {
  name?: string;
  idx?: number | null;
  item_code?: string;
  item_name?: string;
  qty?: number | null;
  uom?: string;
  rate?: number | null;
  amount?: number | null;
  batch_no?: string;
  expiry_date?: string;
  dosage?: string;
  dispensing_lot?: string;
}

export function resolvePosDispensedItemCode(item: PosDispensedMedicationItem): string {
  return (item.item_code || "").trim();
}

export function resolvePosDispensedDisplayName(item: PosDispensedMedicationItem): string {
  return item.item_name?.trim() || item.item_code?.trim() || "—";
}

export function posDispensedLineKey(
  txnName: string,
  idx: number,
  item: PosDispensedMedicationItem
): string {
  const code = resolvePosDispensedItemCode(item) || item.name || String(idx);
  return dispensedMedicationLineKey("pos", txnName, idx, code);
}

export function posDispensedItemToLegacyShape(
  item: PosDispensedMedicationItem
): LegacyDispensedMedicationItem {
  return {
    name: item.name,
    sr_num: item.idx ?? null,
    item: item.item_code,
    item_name: item.item_name,
    item_num: item.item_code,
    show_qty: item.qty ?? null,
    show_uom: item.uom,
    show_rate: item.rate ?? null,
    show_amt: item.amount ?? null,
    item_expiry_date: item.expiry_date,
    ais_batch_num: item.batch_no,
  };
}

export interface PosDispensedTransaction {
  name: string;
  source?: "pos";
  transaction_date?: string;
  customer?: string;
  customer_name?: string;
  patient?: string;
  grand_total?: number | null;
  status?: string;
  custom_remarks?: string;
  custom_reference_type?: string;
  custom_reference_name?: string;
  set_warehouse?: string;
  visit_type?: string | null;
  delivery_note?: string | null;
  item_count?: number;
  items: PosDispensedMedicationItem[];
}

export async function getPatientPosDispensedMedications(
  patient: string,
  limit = 50
): Promise<PosDispensedTransaction[]> {
  try {
    const apiUrl = `/api/method/klik_pos.api.patient.get_patient_pos_dispensed_medications?patient=${encodeURIComponent(patient)}&limit=${encodeURIComponent(String(limit))}`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch POS dispensed medications');
    }
    return data?.message || [];
  } catch (error) {
    console.error('Error fetching POS dispensed medications:', error);
    return [];
  }
}

export interface SubscriptionMedicationPlanItem {
  name?: string;
  medication_order_entry?: string;
  drug?: string;
  drug_name?: string;
  dosage?: number | string | null;
  dosage_form?: string;
  instructions?: string;
  patient_frequency?: string;
  date?: string | null;
  time?: string | null;
  qty_per_cycle?: number | null;
  is_active?: number;
  old_med_no?: string;
  old_medication_name?: string;
}

export interface SubscriptionMedicationPlan {
  name: string;
  patient?: string;
  patient_name?: string;
  practitioner?: string;
  practitioner_name?: string;
  company?: string;
  frequency?: string;
  start_date?: string | null;
  end_date?: string | null;
  next_run_date?: string | null;
  status?: string;
  item_count?: number;
  medications: SubscriptionMedicationPlanItem[];
}

export function resolveSubscriptionItemCode(item: SubscriptionMedicationPlanItem): string {
  return (item.drug || item.old_med_no || "").trim();
}

export function resolveSubscriptionItemDisplayName(item: SubscriptionMedicationPlanItem): string {
  return (
    item.drug_name?.trim() ||
    item.old_medication_name?.trim() ||
    resolveSubscriptionItemCode(item) ||
    "—"
  );
}

export function subscriptionMedicationLineKey(
  planName: string,
  idx: number,
  item: SubscriptionMedicationPlanItem
): string {
  const code = resolveSubscriptionItemCode(item) || item.name || String(idx);
  return `smp::${planName}::${idx}::${code}`;
}

export async function getSubscriptionMedicationPlans(args?: {
  patient?: string;
  search?: string;
  limit?: number;
  start?: number;
}): Promise<SubscriptionMedicationPlan[]> {
  try {
    const params = new URLSearchParams();
    if (args?.patient?.trim()) params.set("patient", args.patient.trim());
    if (args?.search?.trim()) params.set("search", args.search.trim());
    params.set("limit", String(args?.limit ?? 50));
    params.set("start", String(args?.start ?? 0));
    const apiUrl = `/api/method/klik_pos.api.patient.get_subscription_medication_plans?${params.toString()}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch subscription medication plans");
    }
    return data?.message || [];
  } catch (error) {
    console.error("Error fetching subscription medication plans:", error);
    return [];
  }
}

function extractFrappeErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const payload = data as {
    message?: unknown;
    exc?: string;
    _server_messages?: string;
  };
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  if (payload._server_messages) {
    try {
      const messages = JSON.parse(payload._server_messages) as string[];
      for (const raw of messages) {
        try {
          const parsed = JSON.parse(raw) as { message?: string };
          if (parsed?.message) return parsed.message;
        } catch {
          if (raw) return raw;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

function getCsrfToken(): string {
  if (typeof window === "undefined") return "";
  return (
    (window as unknown as { csrf_token?: string }).csrf_token ||
    (window as unknown as { frappe?: { csrf_token?: string } }).frappe?.csrf_token ||
    ""
  );
}

export interface WhatsAppTemplateOption {
  name: string;
  template_name: string;
  actual_name?: string;
  purpose?: string;
  header_type?: string;
  header_text?: string;
  body_text?: string;
  footer_text?: string;
  field_names?: string;
  language_code?: string;
  variable_count?: number;
}

export interface SubscriptionMedicationWhatsAppPreview {
  plan: string;
  patient?: string;
  patient_name?: string;
  phone_number?: string;
  country?: string;
  country_isd?: string;
  templates: WhatsAppTemplateOption[];
  selected_template?: string | null;
  parameters: string[];
  preview: {
    header?: string;
    body?: string;
    footer?: string;
    template_name?: string;
    actual_name?: string;
  } | null;
  fallback_body?: string;
}

export async function getSubscriptionMedicationWhatsAppPreview(
  planName: string,
  templateName?: string
): Promise<SubscriptionMedicationWhatsAppPreview> {
  const csrf = getCsrfToken();
  const response = await fetch(
    "/api/method/healthcare.healthcare.doctype.subscription_medication_plan.subscription_medication_plan.get_subscription_medication_whatsapp_preview",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-Frappe-CSRF-Token": csrf } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        name: planName,
        ...(templateName ? { template_name: templateName } : {}),
      }),
    }
  );
  const data = await response.json();
  if (!response.ok || data?.exc || data?.exc_type) {
    throw new Error(extractFrappeErrorMessage(data, "Failed to load WhatsApp preview"));
  }
  return data?.message as SubscriptionMedicationWhatsAppPreview;
}

/** Send WhatsApp (Digital Connect) reminder for a Subscription Medication Plan. */
export async function sendSubscriptionMedicationReminder(
  planName: string,
  channel: "whatsapp" | "sms" | "email" = "whatsapp",
  options?: {
    phone_number?: string;
    template_name?: string;
    template_parameters?: string | string[];
  }
): Promise<{ sent: boolean; channel: string; patient?: string; plan?: string }> {
  const csrf = getCsrfToken();
  const response = await fetch(
    "/api/method/healthcare.healthcare.doctype.subscription_medication_plan.subscription_medication_plan.send_subscription_medication_reminder",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-Frappe-CSRF-Token": csrf } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        name: planName,
        channel,
        phone_number: options?.phone_number || undefined,
        template_name: options?.template_name || undefined,
        template_parameters: Array.isArray(options?.template_parameters)
          ? JSON.stringify(options?.template_parameters)
          : options?.template_parameters,
      }),
    }
  );
  const data = await response.json();
  if (!response.ok || data?.exc || data?.exc_type) {
    throw new Error(extractFrappeErrorMessage(data, "Failed to send reminder"));
  }
  return (
    (data?.message as { sent: boolean; channel: string; patient?: string; plan?: string }) || {
      sent: true,
      channel,
    }
  );
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

export interface OpenPharmacyPatientVisit {
  doctype: string;
  name: string;
  patient?: string;
  patient_name?: string;
  status?: string;
  visit_type?: string;
  encounter_date?: string;
  visit_date?: string;
  posting_date?: string;
  practitioner_name?: string;
  docstatus?: number;
}

export async function getOpenPharmacyPatientVisits(
  patient: string,
  opts?: {
    limit?: number;
    includeClosed?: boolean;
    fromDate?: string;
    toDate?: string;
  }
): Promise<OpenPharmacyPatientVisit[]> {
  try {
    const limit = opts?.limit ?? 20;
    const params = new URLSearchParams();
    params.set("patient", patient);
    params.set("limit", String(limit));
    if (opts?.includeClosed) {
      params.set("include_closed", "1");
      if (opts.fromDate) params.set("from_date", opts.fromDate);
      if (opts.toDate) params.set("to_date", opts.toDate);
    }
    const apiUrl = `/api/method/klik_pos.api.patient.get_open_pharmacy_patient_visits?${params.toString()}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || data._server_messages || "Failed to fetch open pharmacy visits");
    }
    if (data.exc_type || data.exception) {
      throw new Error(data.message || data.exception || "Failed to fetch open pharmacy visits");
    }
    const message = data?.message;
    if (message?.success === false) {
      throw new Error(message.message || "Failed to fetch open pharmacy visits");
    }
    return (message?.visits || []) as OpenPharmacyPatientVisit[];
  } catch (error) {
    console.error("Error fetching open pharmacy patient visits:", error);
    return [];
  }
}

export async function getPatientVisitDate(
  doctype: string,
  name: string
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ doctype, name });
    const response = await fetch(
      `/api/method/klik_pos.api.patient.get_patient_visit_date?${params.toString()}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );
    const data = await response.json();
    if (!response.ok) return null;
    const message = data?.message;
    const raw = typeof message === "object" ? message?.date : message;
    const iso = String(raw || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  } catch (error) {
    console.error("Error fetching patient visit date:", error);
    return null;
  }
}

export async function createPatientVisit(
  patient: string
): Promise<{ doctype: string; name: string; docstatus?: number; visit_type?: string | null; cost_center?: string | null; visit_date?: string | null } | null> {
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
