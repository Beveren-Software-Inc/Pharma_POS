type Invoice = {
  doctype: string;
  name: string;
  [key: string]: unknown; // to allow other properties
};

type PrintHTMLResponse = {
  html: string;
  style: string;
};

export async function getPrintFormatHTML(
  invoice: Invoice,
  printFormat: string
): Promise<PrintHTMLResponse> {
  const params = new URLSearchParams({
    doc: invoice.doctype,
    name: invoice.name,
    print_format: printFormat,
    no_letterhead: "0",
  });

  const res = await fetch(
    `/api/method/frappe.www.printview.get_html_and_style?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    }
  );

  const data = await res.json();
  return data.message as PrintHTMLResponse;
}
