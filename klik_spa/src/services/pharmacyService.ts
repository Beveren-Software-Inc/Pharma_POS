export interface PharmacyServiceItem {
  id: string;
  name: string;
  category: string;
  price: number;
  image?: string;
  uom?: string;
  item_tax_template?: string;
  currency_symbol?: string;
  is_pharmacy_service?: number | boolean;
}

export async function getPharmacyServiceItems(
  search?: string
): Promise<PharmacyServiceItem[]> {
  try {
    const params = new URLSearchParams();
    if (search?.trim()) {
      params.set("search", search.trim());
    }
    const query = params.toString();
    const response = await fetch(
      `/api/method/klik_pos.api.item.get_pharmacy_service_items${query ? `?${query}` : ""}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch pharmacy service items");
    }
    return data?.message?.items || [];
  } catch (error) {
    console.error("Error fetching pharmacy service items:", error);
    return [];
  }
}
