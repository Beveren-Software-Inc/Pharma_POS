export interface PrescriptionFrequency {
  name: string;
  frequency?: string;
  dosage?: string;
  prescription_frequency?: string;
  active?: number | boolean | string;
  [key: string]: unknown;
}

function isActivePrescriptionFrequency(freq: PrescriptionFrequency): boolean {
  return freq.active === 1 || freq.active === true || freq.active === "1";
}

export async function getPrescriptionFrequencies(): Promise<PrescriptionFrequency[]> {
  try {
    const response = await fetch(
      `/api/method/klik_pos.api.prescription_frequency.get_prescription_frequencies`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ API Error:", data.message || "Failed to fetch Prescription Frequencies");
      throw new Error(data.message || "Failed to fetch Prescription Frequencies");
    }

    if (data?.message) {
      const rows = Array.isArray(data.message) ? data.message : [];
      const hasActiveField = rows.some((row) =>
        Object.prototype.hasOwnProperty.call(row, "active")
      );
      return hasActiveField ? rows.filter(isActivePrescriptionFrequency) : rows;
    }

    console.warn("⚠️ No message in response, returning empty array");
    return [];
  } catch (error) {
    console.error("❌ Error fetching Prescription Frequencies:", error);
    return [];
  }
}
