export interface PrescriptionFrequency {
  name: string;
  frequency?: string;
  dosage?: string;
  prescription_frequency?: string;
  [key: string]: unknown;
}

export async function getPrescriptionFrequencies(): Promise<PrescriptionFrequency[]> {
  try {
    console.log('📡 Fetching prescription frequencies from API...');
    const response = await fetch(`/api/method/klik_pos.api.prescription_frequency.get_prescription_frequencies`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    console.log('📡 API Response status:', response.status, response.statusText);

    const data = await response.json();
    console.log('📡 API Response data:', data);

    if (!response.ok) {
      console.error('❌ API Error:', data.message || 'Failed to fetch Prescription Frequencies');
      throw new Error(data.message || 'Failed to fetch Prescription Frequencies');
    }

    if (data?.message) {
      console.log('✅ Prescription frequencies received:', data.message);
      return data.message;
    }

    console.warn('⚠️ No message in response, returning empty array');
    return [];
  } catch (error) {
    console.error(`❌ Error fetching Prescription Frequencies:`, error);
    return [];
  }
}
