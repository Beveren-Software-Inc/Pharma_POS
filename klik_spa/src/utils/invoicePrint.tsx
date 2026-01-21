import PrintPreview  from "../utils/posPreview"

interface Invoice {
  name?: string;
  id?: string;
  pos_profile?: string;
  [key: string]: unknown;
}

export default function DisplayPrintPreview({ invoice }: { invoice: Invoice }) {
  // Ensure invoice has required fields for PrintPreview
  const invoiceWithRequiredFields = {
    pos_profile: (typeof invoice.pos_profile === 'string' ? invoice.pos_profile : '') || '',
    name: (typeof invoice.name === 'string' ? invoice.name : invoice.id) || '',
    ...invoice
  };

  return (
      <PrintPreview invoice={invoiceWithRequiredFields} />

  );
}
