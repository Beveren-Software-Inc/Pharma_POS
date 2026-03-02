import { useEffect, useState } from "react";

/**
 * Fetches the total tax amount for free items (same logic as backend).
 * Used so the payment dialog grand total includes tax on free items.
 */
export function useFreeItemTaxAmount(
  cartItems: Array<{ id?: string; item_code?: string; quantity: number; uom?: string; is_free_item?: boolean }>,
  isItemTaxTemplateMode: boolean
) {
  const [freeItemTaxAmount, setFreeItemTaxAmount] = useState(0);

  const freeItems = cartItems.filter(
    (item) => (item as { is_free_item?: boolean }).is_free_item && (item.quantity || 0) > 0
  );
  const payload =
    freeItems.length > 0
      ? JSON.stringify(
          freeItems.map((item) => ({
            item_code: item.item_code || item.id,
            qty: item.quantity || 0,
            // Pass UOM so backend can use correct UOM-based rate for tax
            uom: (item as { uom?: string }).uom || undefined,
          }))
        )
      : "";

  useEffect(() => {
    if (!isItemTaxTemplateMode || freeItems.length === 0 || !payload || payload === "[]") {
      setFreeItemTaxAmount(0);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(
          `/api/method/klik_pos.api.tax.get_free_item_tax_amount?items=${encodeURIComponent(payload)}`,
          { credentials: "include" }
        );
        const data = await res.json();
        if (cancelled) return;
        if (data?.message?.success && typeof data?.message?.total_tax === "number") {
          setFreeItemTaxAmount(data.message.total_tax);
        } else {
          setFreeItemTaxAmount(0);
        }
      } catch {
        if (!cancelled) setFreeItemTaxAmount(0);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isItemTaxTemplateMode, payload]);

  return freeItemTaxAmount;
}
