"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Check, ChevronDown, Printer, ClipboardList, Clock, UserPlus, CheckCircle, History, AlertTriangle, Stethoscope } from "lucide-react";
import type { InpatientMedicationOrder, PatientHistorySummary, ItemAlternativeOption } from "../services/patientService";
import { getItemAlternatives } from "../services/patientService";

interface InpatientMedicationOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingOrders: InpatientMedicationOrder[];
  historyOrders: InpatientMedicationOrder[];
  selectedOrders: Set<string>;
  onToggleOrder: (orderName: string) => void;
  onAddToCart: (alternatives?: Record<string, string>) => void;
  selectedHistoryItems: Set<string>;
  onToggleHistoryItem: (itemKey: string) => void;
  onAddHistoryItemsToCart: () => void;
  onCreateVisit: () => void;
  creatingVisit?: boolean;
  patientName?: string;
  patientId?: string;
  isHospitalMode?: boolean;
  /** Shown on Patient Visit tab after a successful create (persists while modal can reopen). */
  lastCreatedVisit?: { doctype: string; name: string } | null;
  /** Incremented on each successful visit create — switches modal to Patient Visit tab. */
  patientVisitCreatedSignal?: number;
  patientHistory?: PatientHistorySummary | null;
  productAvailability?: Record<string, number>;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  Draft:        { label: "Draft",       classes: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 border border-gray-200 dark:border-gray-600" },
  Submitted:    { label: "Submitted",   classes: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-700" },
  Pending:      { label: "Pending",     classes: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700" },
  "In Process": { label: "In Process",  classes: "bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 border border-violet-200 dark:border-violet-700" },
  Completed:    { label: "Completed",   classes: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700" },
  Cancelled:    { label: "Cancelled",   classes: "bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-700" },
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const cfg = STATUS_CONFIG[status] ?? { label: status, classes: "bg-gray-100 text-gray-500 border border-gray-200" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold tracking-wide ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── Shared item row type ──────────────────────────────────────────────────────
interface ItemRow {
  drug?: string;
  drug_name?: string;
  dosage?: string;
  quantity?: number | string | null;
  uom?: string;
  patient_frequency?: string;
  medication_type?: string;
  is_prn?: number | boolean | string;
}

// ── Alternative drug dropdown ─────────────────────────────────────────────────
function AlternativeDrugSelect({
  drugCode,
  value,
  lowStock,
  options,
  loading,
  onChange,
}: {
  drugCode?: string;
  value: string;
  lowStock: boolean;
  options: ItemAlternativeOption[];
  loading?: boolean;
  onChange: (value: string) => void;
}) {
  if (!drugCode) {
    return <span className="text-gray-300">—</span>;
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
      className={`w-full min-w-[140px] max-w-[220px] px-2 py-1 text-xs border rounded bg-white dark:bg-gray-800
        ${lowStock ? "border-red-300 dark:border-red-700" : "border-gray-300 dark:border-gray-600"}
        disabled:opacity-60`}
    >
      <option value="">
        {loading ? "Loading items…" : lowStock ? "Select alternative" : "Optional"}
      </option>
      {options.map((opt) => (
        <option key={opt.item_code} value={opt.item_code}>
          {opt.item_name} ({opt.item_code}) · {opt.available}
        </option>
      ))}
    </select>
  );
}

// ── Reusable items table ──────────────────────────────────────────────────────
function ItemsTable({
  items,
  selectable,
  selectedKeys,
  onToggle,
  orderName,
  productAvailability,
  alternativeDrugs,
  onAlternativeChange,
  alternativeOptionsByDrug,
  loadingAlternativeDrugs,
}: {
  items: ItemRow[];
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggle?: (key: string) => void;
  orderName?: string;
  productAvailability?: Record<string, number>;
  alternativeDrugs?: Record<string, string>;
  onAlternativeChange?: (key: string, value: string) => void;
  alternativeOptionsByDrug?: Record<string, ItemAlternativeOption[]>;
  loadingAlternativeDrugs?: Record<string, boolean>;
}) {
  if (!items.length) return null;
  const isPrn = (v: ItemRow["is_prn"]) => v === 1 || v === true || v === "1";

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/70 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {selectable && <th className="px-3 py-2 w-8" />}
            <th className="px-3 py-2 text-left">Drug</th>
            <th className="px-3 py-2 text-left">Dosage</th>
            <th className="px-3 py-2 text-left">Qty</th>
            <th className="px-3 py-2 text-left">Frequency</th>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-center">PRN</th>
            {productAvailability && <th className="px-3 py-2 text-left">Stock</th>}
            {onAlternativeChange && <th className="px-3 py-2 text-left">Alt. Drug</th>}
           </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {items.map((item, idx) => {
            const itemKey = `${orderName}::${idx}::${item.drug ?? ""}`;
            const checked = selectedKeys?.has(itemKey) ?? false;
            const avail = item.drug ? productAvailability?.[item.drug] : undefined;
            const lowStock = avail !== undefined && (avail <= 0 || avail < Number(item.quantity || 1));
            return (
              <tr
                key={idx}
                onClick={selectable && onToggle ? () => onToggle(itemKey) : undefined}
                className={`transition-colors
                  ${selectable ? "cursor-pointer" : ""}
                  ${checked
                    ? "bg-orange-50 dark:bg-orange-900/20"
                    : selectable
                    ? "bg-white dark:bg-gray-900 hover:bg-orange-50/50 dark:hover:bg-orange-900/10"
                    : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  }`}
              >
                {selectable && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle?.(itemKey)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                   </td>
                )}
                <td className="px-3 py-2 font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                  {item.drug_name || item.drug || "—"}
                 </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {item.dosage || "—"}
                 </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {item.quantity != null ? `${item.quantity}${item.uom ? ` ${item.uom}` : ""}` : "—"}
                 </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {item.patient_frequency || "—"}
                 </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {item.medication_type || "—"}
                 </td>
                <td className="px-3 py-2 text-center">
                  {isPrn(item.is_prn)
                    ? <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">PRN</span>
                    : <span className="text-gray-300 dark:text-gray-600">—</span>
                  }
                 </td>
                {productAvailability && (
                  <td className={`px-3 py-2 whitespace-nowrap ${lowStock ? "text-red-600 font-semibold" : "text-gray-500"}`}>
                    {avail === undefined ? "N/A" : avail}
                  </td>
                )}
                {onAlternativeChange && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <AlternativeDrugSelect
                      drugCode={item.drug}
                      value={alternativeDrugs?.[itemKey] || ""}
                      lowStock={!!lowStock}
                      options={item.drug ? alternativeOptionsByDrug?.[item.drug] || [] : []}
                      loading={item.drug ? loadingAlternativeDrugs?.[item.drug] : false}
                      onChange={(next) => onAlternativeChange(itemKey, next)}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function InpatientMedicationOrdersModal({
  isOpen,
  onClose,
  pendingOrders,
  historyOrders,
  selectedOrders,
  onToggleOrder,
  onAddToCart,
  selectedHistoryItems,
  onToggleHistoryItem,
  onAddHistoryItemsToCart,
  onCreateVisit,
  creatingVisit = false,
  patientName,
  patientId,
  isHospitalMode = false,
  lastCreatedVisit = null,
  patientVisitCreatedSignal = 0,
  patientHistory = null,
  productAvailability = {},
}: InpatientMedicationOrdersModalProps) {
  const [activeTab, setActiveTab] = useState<"pending" | "history" | "visit" | "patient_history">("pending");
  const [alternativeDrugs, setAlternativeDrugs] = useState<Record<string, string>>({});
  const [alternativeOptionsByDrug, setAlternativeOptionsByDrug] = useState<Record<string, ItemAlternativeOption[]>>({});
  const [loadingAlternativeDrugs, setLoadingAlternativeDrugs] = useState<Record<string, boolean>>({});
  const fetchedAlternativeDrugsRef = useRef<Set<string>>(new Set());
  const [expandedHistoryOrders, setExpandedHistoryOrders] = useState<Set<string>>(new Set());
  const [expandedDiagnosisEntries, setExpandedDiagnosisEntries] = useState<Set<string>>(new Set());
  const [expandedPatientHistoryOrders, setExpandedPatientHistoryOrders] = useState<Set<string>>(new Set());
  const [openPrintMenuFor, setOpenPrintMenuFor] = useState<string | null>(null);
  const [printMenuPosition, setPrintMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const printButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setActiveTab("pending");
      setExpandedHistoryOrders(new Set());
      setExpandedDiagnosisEntries(new Set());
      setExpandedPatientHistoryOrders(new Set());
      setOpenPrintMenuFor(null);
      setPrintMenuPosition(null);
      setAlternativeDrugs({});
      setAlternativeOptionsByDrug({});
      setLoadingAlternativeDrugs({});
      fetchedAlternativeDrugsRef.current = new Set();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const drugCodes = new Set<string>();
    pendingOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        if (item.drug) drugCodes.add(item.drug);
      });
    });

    drugCodes.forEach((drugCode) => {
      if (fetchedAlternativeDrugsRef.current.has(drugCode)) return;
      fetchedAlternativeDrugsRef.current.add(drugCode);

      setLoadingAlternativeDrugs((prev) => ({ ...prev, [drugCode]: true }));
      void getItemAlternatives(drugCode).then((options) => {
        setAlternativeOptionsByDrug((prev) => ({ ...prev, [drugCode]: options }));
        setLoadingAlternativeDrugs((prev) => ({ ...prev, [drugCode]: false }));
      });
    });
  }, [isOpen, pendingOrders]);

  useEffect(() => {
    if (isOpen && isHospitalMode && patientVisitCreatedSignal > 0) {
      setActiveTab("visit");
    }
  }, [isOpen, isHospitalMode, patientVisitCreatedSignal]);

  const openDocPrint = (doctype: string, name: string) => {
    const params = new URLSearchParams();
    params.set("doctype", doctype);
    params.set("name", name);
    params.set("format", "Standard");
    params.set("trigger_print", "1");
    params.set("no_letterhead", "0");
    const base = typeof window !== "undefined" ? window.location.origin : "";
    window.open(`${base}/printview?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  useLayoutEffect(() => {
    if (!openPrintMenuFor || !printButtonRef.current) return;
    const rect = printButtonRef.current.getBoundingClientRect();
    setPrintMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [openPrintMenuFor]);

  useEffect(() => {
    if (!openPrintMenuFor) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-med-print-menu]") && !t.closest("[data-med-print-trigger]")) {
        setOpenPrintMenuFor(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openPrintMenuFor]);

  const openPrint = (doctype: string, name: string, format = "Standard") => {
    const params = new URLSearchParams({ doctype, name, format, trigger_print: "1", no_letterhead: "0" });
    const base = typeof window !== "undefined" ? window.location.origin : "";
    window.open(`${base}/printview?${params}`, "_blank", "noopener,noreferrer");
  };

  const printMenu =
    openPrintMenuFor && printMenuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            data-med-print-menu
            className="fixed z-[9999] min-w-[160px] rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
            style={{ top: printMenuPosition.top, right: printMenuPosition.right, left: "auto" }}
          >
            <button
              type="button"
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              onClick={() => {
                openPrint("Patient Medication Order", openPrintMenuFor, "Standard");
                setOpenPrintMenuFor(null);
              }}
            >
              <Printer size={13} className="text-slate-400" /> Standard
            </button>
          </div>,
          document.body
        )
      : null;

  if (!isOpen) return null;

  const tabs = [
    { id: "pending" as const, label: "Pending", count: pendingOrders.length, icon: ClipboardList },
    { id: "visit" as const, label: "Patient Visit", count: null, icon: UserPlus },
    { id: "history" as const, label: "History", count: historyOrders.length, icon: Clock },
    { id: "patient_history" as const, label: "Patient History", count: null, icon: History },
  ];

  return (
    <div className="fixed inset-0 lg:left-20 z-50 flex items-center justify-center pointer-events-none">
      <div className="fixed inset-0 lg:left-20 bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={onClose} />

      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-5xl h-[92vh] pointer-events-auto flex flex-col overflow-hidden border border-gray-100 dark:border-gray-700">

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200 dark:border-gray-700 bg-beveren-100 dark:bg-beveren-900/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-600 flex items-center justify-center shadow-sm">
              <ClipboardList size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">Medication Orders</h2>
              {patientName && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">{patientName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/60 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Bar */}
        {isHospitalMode && (
          <div className="px-8 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700/60">
            <div className="flex items-stretch">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center gap-2 px-5 py-4 text-sm font-semibold transition-all duration-150
                      ${isActive
                        ? "text-beveren-600 dark:text-beveren-400"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                      }`}
                  >
                    <Icon size={15} className={isActive ? "text-orange-500" : "text-gray-400"} />
                    <span>{tab.label}</span>
                    {tab.count !== null && (
                      <span className={`ml-0.5 min-w-[20px] h-5 px-1.5 rounded-full text-xs flex items-center justify-center font-bold
                        ${isActive ? "bg-beveren-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}>
                        {tab.count}
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-beveren-600 dark:bg-beveren-400 rounded-t-full" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 bg-white dark:bg-gray-900">

          {/* ── PENDING ── */}
          {(activeTab === "pending" || !isHospitalMode) && (
            pendingOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
                <ClipboardList size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-medium">No pending medication orders found.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingOrders.map((order) => {
                  const isSelected = selectedOrders.has(order.name);
                  return (
                    <div
                      key={order.name}
                      className={`group border rounded-xl p-4 cursor-pointer transition-all duration-150
                        ${isSelected
                          ? "border-orange-400 bg-orange-50 dark:bg-orange-900/20 shadow-sm"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm"
                        }`}
                      onClick={() => onToggleOrder(order.name)}
                    >
                      {/* Row: checkbox · name · date · doctor · print */}
                      <div className="flex items-center gap-3">
                        <div className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors
                          ${isSelected
                            ? "bg-orange-500 border-orange-500"
                            : "border-gray-300 dark:border-gray-600 group-hover:border-orange-400"
                          }`}>
                          {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
                        </div>
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm flex-1">{order.name}</h3>
                        {order.posting_date && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                            {new Date(order.posting_date).toLocaleDateString()}
                          </span>
                        )}
                        <button
                          ref={openPrintMenuFor === order.name ? printButtonRef : null}
                          data-med-print-trigger
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenPrintMenuFor((p) => (p === order.name ? null : order.name));
                          }}
                          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Print order"
                        >
                          <Printer size={14} />
                        </button>
                      </div>

                      {(order.healthcare_practitioner_name || order.healthcare_practitioner) && (
                        <div className="mt-2 ml-8 text-xs text-gray-600 dark:text-gray-300">
                          Prescribed by: <span className="font-semibold">{order.healthcare_practitioner_name || order.healthcare_practitioner}</span>
                        </div>
                      )}

                      {/* Items table */}
                      {order.items && order.items.length > 0 && (
                        <div className="mt-3 ml-8" onClick={(e) => e.stopPropagation()}>
                          <ItemsTable
                            items={order.items}
                            orderName={order.name}
                            productAvailability={productAvailability}
                            alternativeDrugs={alternativeDrugs}
                            alternativeOptionsByDrug={alternativeOptionsByDrug}
                            loadingAlternativeDrugs={loadingAlternativeDrugs}
                            onAlternativeChange={(key, value) =>
                              setAlternativeDrugs((prev) => ({ ...prev, [key]: value }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ── HISTORY ── */}
          {isHospitalMode && activeTab === "history" && (
            historyOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
                <Clock size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-medium">No medication history found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {historyOrders.slice(0, 50).map((order) => {
                  const isExpanded = expandedHistoryOrders.has(order.name);
                  return (
                    <div
                      key={order.name}
                      className="border border-orange-200 dark:border-orange-800/60 rounded-xl overflow-hidden bg-orange-50/40 dark:bg-orange-900/10"
                    >
                      {/* Accordion header */}
                      <div className="flex items-center gap-2 px-4 py-3 bg-orange-100/70 dark:bg-orange-900/20">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedHistoryOrders((prev) => {
                              const next = new Set(prev);
                              next.has(order.name) ? next.delete(order.name) : next.add(order.name);
                              return next;
                            })
                          }
                          className="flex items-center gap-2 text-left flex-1 min-w-0"
                        >
                          <span className={`text-gray-400 transition-transform duration-150 flex-shrink-0 ${isExpanded ? "rotate-0" : "-rotate-90"}`}>
                            <ChevronDown size={15} />
                          </span>
                          <span className="font-semibold text-sm text-gray-800 dark:text-white truncate">{order.name}</span>
                          {order.posting_date && (
                            <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
                              {new Date(order.posting_date).toLocaleDateString()}
                            </span>
                          )}
                          {(order.healthcare_practitioner_name || order.healthcare_practitioner) && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-shrink-0">
                              Dr: {order.healthcare_practitioner_name || order.healthcare_practitioner}
                            </span>
                          )}
                          <StatusBadge status={order.status} />
                        </button>
                        <button
                          ref={openPrintMenuFor === order.name ? printButtonRef : null}
                          data-med-print-trigger
                          type="button"
                          onClick={() => setOpenPrintMenuFor((p) => (p === order.name ? null : order.name))}
                          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Print order"
                        >
                          <Printer size={14} />
                        </button>
                      </div>

                      {/* Expanded — selectable items table */}
                      {isExpanded && order.items && order.items.length > 0 && (
                        <div className="px-4 py-3 border-t border-orange-200 dark:border-orange-800/40 bg-white/70 dark:bg-gray-900/20">
                          <ItemsTable
                            items={order.items}
                            selectable
                            selectedKeys={selectedHistoryItems}
                            onToggle={onToggleHistoryItem}
                            orderName={order.name}
                          />
                        </div>
                      )}

                      {isExpanded && (!order.items || order.items.length === 0) && (
                        <div className="px-4 py-4 border-t border-orange-200 dark:border-orange-800/40 text-sm text-gray-400 dark:text-gray-500 text-center bg-white/70 dark:bg-gray-900/20">
                          No items in this order.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ── PATIENT HISTORY ── */}
          {isHospitalMode && activeTab === "patient_history" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800/40">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Patient Details</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-500">Name:</span> <span className="font-medium">{String(patientHistory?.patient?.patient_name || patientName || "—")}</span></div>
                  <div><span className="text-gray-500">ID:</span> <span className="font-mono">{String(patientHistory?.patient?.name || patientId || "—")}</span></div>
                  {patientHistory?.patient?.file_no ? <div><span className="text-gray-500">File No:</span> {String(patientHistory.patient.file_no)}</div> : null}
                  {patientHistory?.patient?.sex ? <div><span className="text-gray-500">Sex:</span> {String(patientHistory.patient.sex)}</div> : null}
                  {patientHistory?.patient?.blood_group ? <div><span className="text-gray-500">Blood:</span> {String(patientHistory.patient.blood_group)}</div> : null}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
                  <Stethoscope size={15} className="text-gray-500" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Medical Diagnosis</h3>
                </div>
                {(patientHistory?.diagnosis_entries || []).length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No diagnosis entries found.</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {(patientHistory?.diagnosis_entries || []).map((entry) => {
                      const isExpanded = expandedDiagnosisEntries.has(entry.name);
                      const label = entry.diagnosis_name || entry.diagnosis || entry.name;
                      return (
                        <div key={entry.name} className="bg-white dark:bg-gray-900">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedDiagnosisEntries((prev) => {
                                const next = new Set(prev);
                                next.has(entry.name) ? next.delete(entry.name) : next.add(entry.name);
                                return next;
                              })
                            }
                            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                          >
                            <span className={`text-gray-400 transition-transform duration-150 flex-shrink-0 ${isExpanded ? "rotate-0" : "-rotate-90"}`}>
                              <ChevronDown size={15} />
                            </span>
                            <span className="font-semibold text-sm text-gray-800 dark:text-white flex-1 truncate">{label}</span>
                            {entry.posting_date ? (
                              <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
                                {String(entry.posting_date).slice(0, 10)}
                              </span>
                            ) : null}
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-0 ml-7 space-y-2 text-sm border-t border-gray-100 dark:border-gray-800">
                              {entry.practitioner_name ? (
                                <div><span className="text-gray-500">Practitioner:</span> <span className="font-medium">{entry.practitioner_name}</span></div>
                              ) : null}
                              {entry.visit_num ? (
                                <div><span className="text-gray-500">Visit:</span> <span className="font-mono text-xs">{entry.visit_num}</span></div>
                              ) : null}
                              {entry.inpatient_admission ? (
                                <div><span className="text-gray-500">Admission:</span> <span className="font-mono text-xs">{entry.inpatient_admission}</span></div>
                              ) : null}
                              {entry.details ? (
                                <div className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{entry.details}</div>
                              ) : (
                                <div className="text-gray-400">No additional details.</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Recent Visits</h3>
                </div>
                {(patientHistory?.visits || []).length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No recent visits.</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {(patientHistory?.visits || []).slice(0, 5).map((visit, idx) => (
                      <div key={`${visit.name}-${idx}`} className="px-4 py-3 text-sm flex justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{String(visit.name)}</div>
                          <div className="text-xs text-gray-500">{String(visit.doctype || "Visit")} · {String(visit.visit_type || "—")}</div>
                        </div>
                        <div className="text-xs text-gray-500 tabular-nums">
                          {String(visit.visit_date || visit.encounter_date || visit.posting_date || "")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Past Medication Orders</h3>
                </div>
                {(patientHistory?.medication_orders || []).length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No past medication orders.</div>
                ) : (
                  <div className="space-y-2 p-2">
                    {(patientHistory?.medication_orders || []).slice(0, 10).map((order) => {
                      const isExpanded = expandedPatientHistoryOrders.has(order.name);
                      return (
                        <div
                          key={order.name}
                          className="border border-orange-200 dark:border-orange-800/60 rounded-xl overflow-hidden bg-orange-50/40 dark:bg-orange-900/10"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedPatientHistoryOrders((prev) => {
                                const next = new Set(prev);
                                next.has(order.name) ? next.delete(order.name) : next.add(order.name);
                                return next;
                              })
                            }
                            className="w-full flex items-center gap-2 px-4 py-3 bg-orange-100/70 dark:bg-orange-900/20 text-left"
                          >
                            <span className={`text-gray-400 transition-transform duration-150 flex-shrink-0 ${isExpanded ? "rotate-0" : "-rotate-90"}`}>
                              <ChevronDown size={15} />
                            </span>
                            <span className="font-semibold text-sm text-gray-800 dark:text-white flex-1 truncate">{order.name}</span>
                            {order.posting_date ? (
                              <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
                                {new Date(order.posting_date).toLocaleDateString()}
                              </span>
                            ) : null}
                            <StatusBadge status={order.status} />
                          </button>
                          {isExpanded && order.items && order.items.length > 0 && (
                            <div className="px-4 py-3 border-t border-orange-200 dark:border-orange-800/40 bg-white/70 dark:bg-gray-900/20">
                              <ItemsTable items={order.items} orderName={order.name} />
                            </div>
                          )}
                          {isExpanded && (!order.items || order.items.length === 0) && (
                            <div className="px-4 py-4 border-t border-orange-200 dark:border-orange-800/40 text-sm text-gray-400 text-center bg-white/70 dark:bg-gray-900/20">
                              No items in this order.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 overflow-hidden">
                <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />
                  <h3 className="text-sm font-bold text-amber-900 dark:text-amber-100">Warnings &amp; Allergies</h3>
                </div>
                <div className="p-4 space-y-4 bg-white dark:bg-gray-900">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Allergies</h4>
                    {patientHistory?.patient?.allergies ? (
                      <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{String(patientHistory.patient.allergies)}</p>
                    ) : (
                      <p className="text-sm text-gray-400">No allergies recorded on patient file.</p>
                    )}
                  </div>
                  {patientHistory?.patient?.medication ? (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Current Medication</h4>
                      <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{String(patientHistory.patient.medication)}</p>
                    </div>
                  ) : null}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Warning Messages</h4>
                    {(patientHistory?.warning_messages || []).length === 0 ? (
                      <p className="text-sm text-gray-400">No warning messages on file.</p>
                    ) : (
                      <div className="space-y-2">
                        {(patientHistory?.warning_messages || []).map((warning) => (
                          <div
                            key={warning.name}
                            className="rounded-lg border border-amber-100 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2 text-sm"
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              {warning.type_of_warning ? (
                                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200/80 dark:bg-amber-800/50 text-amber-900 dark:text-amber-100">
                                  {warning.type_of_warning}
                                </span>
                              ) : null}
                              {warning.posting_date ? (
                                <span className="text-xs text-gray-500 tabular-nums">{String(warning.posting_date).slice(0, 10)}</span>
                              ) : null}
                              {warning.practitioner_name ? (
                                <span className="text-xs text-gray-500">Dr: {warning.practitioner_name}</span>
                              ) : null}
                            </div>
                            <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                              {warning.high_risk_text || warning.warning || "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── VISIT ── */}
          {isHospitalMode && activeTab === "visit" && (
            <div className="max-w-lg mx-auto py-6 space-y-4">
              {lastCreatedVisit?.name && (
                <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-900/20 overflow-hidden">
                  <div className="px-5 py-4 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
                      <CheckCircle size={22} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Patient visit created</p>
                      <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80 mt-1">
                        This document is linked when you press <span className="font-semibold">Dispense</span> on the cart.
                      </p>
                      <div className="mt-3 space-y-1.5 text-sm">
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/70">Type</span>
                          <span className="font-mono text-emerald-900 dark:text-emerald-100">{lastCreatedVisit.doctype}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/70">Name</span>
                          <span className="font-mono font-semibold text-emerald-950 dark:text-emerald-50 break-all">{lastCreatedVisit.name}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openDocPrint(lastCreatedVisit.doctype, lastCreatedVisit.name)}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-orange-600 bg-white dark:bg-gray-900 border-2 border-orange-600 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                      >
                        <Printer size={16} />
                        Print visit
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-5 bg-beveren-50 dark:bg-beveren-900/20 border-b border-beveren-100 dark:border-beveren-800/30">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-orange-600 flex items-center justify-center">
                      <UserPlus size={17} className="text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white text-base">
                        {lastCreatedVisit?.name ? "Create another visit" : "Create Patient Visit"}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Non-charging pharmacy visit (no sales order)
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    Patient: <span className="font-semibold text-gray-900 dark:text-white">{patientName || "—"}</span>
                    {patientId ? (
                      <span className="text-gray-500 dark:text-gray-400"> · ID: <span className="font-mono">{patientId}</span></span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={onCreateVisit}
                    disabled={creatingVisit}
                    className="w-full px-4 py-3 text-sm font-bold text-orange-600 bg-white border-2 border-orange-600 rounded-xl hover:bg-orange-50 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                  >
                    {creatingVisit ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-orange-600/30 border-t-orange-600 rounded-full animate-spin" />
                        Creating…
                      </span>
                    ) : lastCreatedVisit?.name ? "Create another Patient Visit" : "Create Patient Visit"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-4 border-t border-gray-200 dark:border-gray-700 bg-beveren-100 dark:bg-beveren-900/20">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500">
            {!isHospitalMode
              ? `${selectedOrders.size} of ${pendingOrders.length} order(s) selected`
              : activeTab === "pending"
              ? `${selectedOrders.size} of ${pendingOrders.length} pending selected`
              : activeTab === "history"
              ? `${selectedHistoryItems.size} item(s) selected`
              : activeTab === "patient_history"
              ? "Diagnosis, visits, warnings and allergies"
              : lastCreatedVisit?.name
              ? "Visit created — used when you dispense"
              : "Create a new encounter above"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            {(activeTab === "pending" || !isHospitalMode) && (
              <button
                onClick={() => onAddToCart(alternativeDrugs)}
                disabled={selectedOrders.size === 0}
                className="px-5 py-2 text-sm font-bold text-orange-600 bg-white border-2 border-orange-600 rounded-lg hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-[0.99]"
              >
                Add to Cart {selectedOrders.size > 0 && `(${selectedOrders.size})`}
              </button>
            )}
            {isHospitalMode && activeTab === "history" && (
              <button
                onClick={onAddHistoryItemsToCart}
                disabled={selectedHistoryItems.size === 0}
                className="px-5 py-2 text-sm font-bold text-orange-600 bg-white border-2 border-orange-600 rounded-lg hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-[0.99]"
              >
                Add Selected {selectedHistoryItems.size > 0 && `(${selectedHistoryItems.size})`}
              </button>
            )}
          </div>
        </div>

        {printMenu}
      </div>
    </div>
  );
}