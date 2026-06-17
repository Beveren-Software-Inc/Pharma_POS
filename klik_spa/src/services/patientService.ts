export interface Patient {
  name: string;
  patient_name?: string;
  patient_id?: string;
  file_no?: string;
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

export interface PatientHistorySummary {
  patient: Record<string, string | number | null | undefined>;
  visits: Array<Record<string, string | number | null | undefined>>;
  medication_orders: InpatientMedicationOrder[];
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
