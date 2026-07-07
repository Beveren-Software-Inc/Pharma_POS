import { FileText, Printer, ExternalLink } from "lucide-react";
import type { PatientUploadDocument } from "../services/patientService";

function resolveFileUrl(path?: string | null): string {
  if (!path?.trim()) return "";
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

function openPatientDocument(url: string, print = false) {
  const fullUrl = resolveFileUrl(url);
  if (!fullUrl) return;
  const popup = window.open(fullUrl, "_blank", "noopener,noreferrer");
  if (print && popup) {
    popup.addEventListener("load", () => {
      try {
        popup.print();
      } catch {
        /* browser may block cross-origin print */
      }
    });
  }
}

function getDocumentLabel(doc: PatientUploadDocument): string {
  return (
    doc.file_name?.trim() ||
    doc.document_name?.trim() ||
    doc.document_type?.trim() ||
    "Document"
  );
}

interface PatientDocumentsSectionProps {
  documents: PatientUploadDocument[];
  loading?: boolean;
  className?: string;
}

export default function PatientDocumentsSection({
  documents,
  loading = false,
  className = "",
}: PatientDocumentsSectionProps) {
  const visibleDocuments = documents.filter(
    (doc) => doc.document || doc.file_name || doc.document_type || doc.document_name
  );

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`}
    >
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <FileText size={16} className="text-gray-500" />
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
          Patient Documents
        </h3>
      </div>
      {loading ? (
        <div className="p-4 sm:p-6 text-sm text-gray-500">Loading documents...</div>
      ) : visibleDocuments.length === 0 ? (
        <div className="p-4 sm:p-6 text-sm text-gray-500">No documents on file for this patient.</div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {visibleDocuments.map((doc, index) => {
            const label = getDocumentLabel(doc);
            const fileUrl = doc.document;
            return (
              <li
                key={doc.name || `doc-${index}`}
                className="px-4 sm:px-6 py-3 sm:py-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{label}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                    {doc.document_type ? <span>Type: {doc.document_type}</span> : null}
                    {doc.transaction_no ? <span>Txn: {doc.transaction_no}</span> : null}
                  </div>
                  {doc.upload_remarks ? (
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                      {doc.upload_remarks}
                    </p>
                  ) : null}
                </div>
                {fileUrl ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openPatientDocument(fileUrl, false)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                      title="Open document"
                    >
                      <ExternalLink size={13} />
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => openPatientDocument(fileUrl, true)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-beveren-600 hover:text-beveren-700 rounded-md hover:bg-beveren-50 dark:hover:bg-beveren-900/20"
                      title="Print document"
                    >
                      <Printer size={13} />
                      Print
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 flex-shrink-0">No file</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
