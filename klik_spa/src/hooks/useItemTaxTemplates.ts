import { useEffect, useState } from "react";

export interface ItemTaxTemplateOption {
  id: string;
  name: string;
}

export function useItemTaxTemplates() {
  const [templates, setTemplates] = useState<ItemTaxTemplateOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(
      "/api/method/klik_pos.api.tax.get_item_tax_templates",
      { credentials: "include" }
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.message?.success && data?.message?.data) {
          setTemplates(data.message.data);
        } else {
          setTemplates([]);
        }
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { templates, loading };
}
