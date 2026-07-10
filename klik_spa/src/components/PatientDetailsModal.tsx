"use client";

import { X, User, FileText, Printer, ExternalLink } from "lucide-react";
import type { Patient, PatientHistorySummary, PatientUploadDocument } from "../services/patientService";
import { getPatientDisplayName, getPatientFileNo } from "../services/patientService";

interface PatientDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient | null;
  patientHistory: PatientHistorySummary | null;
  loading?: boolean;
}

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

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <span className="text-gray-500 dark:text-gray-400">{label}: </span>
      <span className="font-medium text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

export default function PatientDetailsModal({
  isOpen,
  onClose,
  patient,
  patientHistory,
  loading = false,
}: PatientDetailsModalProps) {
  if (!isOpen) return null;

  const details = patientHistory?.patient || {};
  const documents = (patientHistory?.patient_documents || []).filter(
    (doc) => doc.document || doc.file_name || doc.document_type || doc.document_name
  );
  const displayName = getPatientDisplayName(patient || { name: String(details.name || ""), patient_name: String(details.patient_name || "") });
  const fileNo = getPatientFileNo(patient || { name: String(details.name || ""), file_no: String(details.file_no || "") });

  return (
    <div className="fixed inset-0 lg:left-20 z-[110] flex items-center justify-center p-4">
      <div className="fixed inset-0 lg:left-20 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <User size={18} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">Patient Details</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{displayName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading patient details...</div>
          ) : (
            <>
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50/80 dark:bg-gray-800/40">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Demographics</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <DetailRow label="Name" value={displayName} />
                  <DetailRow label="File No" value={fileNo || String(details.file_no || "")} />
                  <DetailRow label="CPR / ID" value={String(details.id_number || patient?.id_number || "")} />
                  <DetailRow label="Sex" value={String(details.sex || "")} />
                  <DetailRow label="Date of birth" value={details.dob ? String(details.dob).slice(0, 10) : ""} />
                  <DetailRow label="Blood group" value={String(details.blood_group || "")} />
                  <DetailRow label="Mobile" value={String(details.mobile || "")} />
                  <DetailRow label="Email" value={String(details.email || "")} />
                </div>
                {details.allergies ? (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Allergies: </span>
                    <span className="text-gray-900 dark:text-white whitespace-pre-wrap">{String(details.allergies)}</span>
                  </div>
                ) : null}
              </section>

              <section className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
                  <FileText size={15} className="text-gray-500" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Patient Documents</h3>
                </div>
                {documents.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No documents on file for this patient.</div>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {documents.map((doc, index) => {
                      const label = getDocumentLabel(doc);
                      const fileUrl = doc.document;
                      return (
                        <li
                          key={doc.name || `doc-${index}`}
                          className="px-4 py-3 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{label}</p>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                              {doc.document_type ? <span>Type: {doc.document_type}</span> : null}
                              {doc.transaction_no ? <span>Txn: {doc.transaction_no}</span> : null}
                            </div>
                            {doc.upload_remarks ? (
                              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{doc.upload_remarks}</p>
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
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
