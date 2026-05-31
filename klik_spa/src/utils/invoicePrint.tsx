import { useMemo } from "react";
import PrintPreview from "../utils/posPreview";

interface Invoice {
  name?: string;
  id?: string;
  pos_profile?: string;
  [key: string]: unknown;
}

export default function DisplayPrintPreview({ invoice }: { invoice: Invoice }) {
  const invoiceName =
    (typeof invoice.name === "string" ? invoice.name : invoice.id) || "";
  const posProfile =
    typeof invoice.pos_profile === "string" ? invoice.pos_profile : "";

  const previewInvoice = useMemo(
    () => ({
      name: invoiceName,
      pos_profile: posProfile,
    }),
    [invoiceName, posProfile]
  );

  if (!invoiceName) {
    return null;
  }

  return <PrintPreview invoice={previewInvoice} />;
}
