import { useState, useEffect } from "react";
import { getPrintFormatHTML } from "./getPrintHTML.js";
import { usePOSDetails } from "../hooks/usePOSProfile.js";

type PrintPreviewProps = {
  invoice: {
    pos_profile?: string;
    name: string;
    [key: string]: unknown;
  };
};

export default function PrintPreview({ invoice }: PrintPreviewProps) {
  const [html, setHtml] = useState("");
  const [style, setStyle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { posDetails, loading: posLoading } = usePOSDetails();
  const printFormat = posDetails?.print_format ?? "Sales Invoice";
  const invoiceName = typeof invoice.name === "string" ? invoice.name : "";

  useEffect(() => {
    if (posLoading) return;
    if (!invoiceName) {
      setLoading(false);
      setError("Invoice name is missing");
      return;
    }

    let cancelled = false;

    const fetchPrintHTML = async () => {
      setLoading(true);
      setError(null);
      try {
        const { html, style } = await getPrintFormatHTML(
          { doctype: "Sales Invoice", name: invoiceName },
          printFormat
        );
        if (cancelled) return;
        setHtml(html);
        setStyle(style);
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading print format:", err);
        setError("Failed to load print preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPrintHTML();

    return () => {
      cancelled = true;
    };
  }, [invoiceName, printFormat, posLoading]);

  return (
    <div
      className="print-preview-container p-4 bg-white text-gray-900 shadow overflow-auto max-h-[90vh] dark:bg-white dark:text-gray-900"
      style={{ colorScheme: "light" }}
    >
      {loading && (
        <p className="text-gray-600 dark:text-gray-400">Loading Print Preview...</p>
      )}
      {!loading && error && (
        <p className="text-red-600 dark:text-red-400">{error}</p>
      )}
      {!loading && !error && (
        <>
          <style dangerouslySetInnerHTML={{ __html: style }} />
          <div
            className="print-preview-content text-gray-900 dark:text-gray-900"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </>
      )}
    </div>
  );
}
