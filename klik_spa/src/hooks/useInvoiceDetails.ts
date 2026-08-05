import { useState, useEffect } from "react";
import type { SalesInvoice } from "../../types";
import { usePOSDetails } from "./usePOSProfile";

function isHospitalPharmacyProfile(posDetails: Record<string, unknown> | null | undefined) {
  const flag = posDetails?.custom_is_hospital_pharmacy;
  return flag === 1 || flag === true || flag === "1";
}

export function useInvoiceDetails(invoiceId: string | null) {
  const [invoice, setInvoice] = useState<SalesInvoice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { posDetails } = usePOSDetails();
  const isHospitalPharmacy = isHospitalPharmacyProfile(posDetails as Record<string, unknown> | null);

  useEffect(() => {
    if (!invoiceId) return;

    const fetchInvoice = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Hospital POS stores dispenses as Sales Orders (SAL-ORD-...), not Sales Invoices.
        const endpoint = isHospitalPharmacy
          ? `/api/method/klik_pos.api.sales_order.get_dispense_order_details?sales_order_name=${encodeURIComponent(invoiceId)}`
          : `/api/method/klik_pos.api.sales_invoice.get_invoice_details?invoice_id=${encodeURIComponent(invoiceId)}`;

        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resData = await response.json();

        if (!resData.message || !resData.message.success) {
          // Fallback: if hospital flag not yet loaded / mismatched, try the other doctype.
          if (!isHospitalPharmacy) {
            const soResponse = await fetch(
              `/api/method/klik_pos.api.sales_order.get_dispense_order_details?sales_order_name=${encodeURIComponent(invoiceId)}`,
              {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                credentials: "include",
              }
            );
            if (soResponse.ok) {
              const soData = await soResponse.json();
              if (soData.message?.success && soData.message.data) {
                setInvoice(soData.message.data);
                return;
              }
            }
          }
          throw new Error(resData.message?.error || resData.error || "Failed to fetch invoice");
        }

        setInvoice(resData.message.data);
      } catch (err: unknown) {
        console.error("Error fetching invoice details:", err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Unknown error");
        }
        setInvoice(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvoice();
  }, [invoiceId, isHospitalPharmacy]);

  return { invoice, isLoading, error };
}
