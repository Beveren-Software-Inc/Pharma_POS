import { useEffect, useState } from "react";

export function useItemTaxTemplateRates(templateNames: string[]) {
  const [rates, setRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const unique = [...new Set(templateNames.filter(Boolean))];

  useEffect(() => {
    if (unique.length === 0) {
      setRates({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/method/klik_pos.api.tax.get_item_tax_template_rates?templates=${encodeURIComponent(JSON.stringify(unique))}`,
      { credentials: "include" }
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.message?.success && data?.message?.rates) {
          setRates(data.message.rates);
        } else {
          setRates({});
        }
      })
      .catch(() => {
        if (!cancelled) setRates({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [unique.join(",")]);

  return { rates, loading };
}
