"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Check, ChevronDown, Printer, ClipboardList, Clock, UserPlus, CheckCircle, History, AlertTriangle, Stethoscope, Search, FileText, ExternalLink, Package, CalendarDays, MessageCircle } from "lucide-react";
import type { InpatientMedicationOrder, PatientHistorySummary, ItemAlternativeOption, PatientUploadDocument, LegacyDispensedTransaction, LegacyDispensedMedicationItem, SubscriptionMedicationPlan, SubscriptionMedicationPlanItem, OpenPharmacyPatientVisit } from "../services/patientService";
import {
  searchPosStockItemsForAlternative,
  getPrintFormatsForDoctype,
  resolveMedicationItemCode,
  resolveMedicationDisplayName,
  resolveLegacyMedicationItemCode,
  resolveLegacyMedicationDisplayName,
  legacyMedicationLineKey,
  resolveSubscriptionItemCode,
  resolveSubscriptionItemDisplayName,
  subscriptionMedicationLineKey,
  getOpenPharmacyPatientVisits,
} from "../services/patientService";
import { toast } from "react-toastify";
import DispenseVisitTypeBadge from "./DispenseVisitTypeBadge";
import MedicationOrderDischargedBadge from "./MedicationOrderDischargedBadge";
import SendSubscriptionMedicationWhatsAppModal from "./SendSubscriptionMedicationWhatsAppModal";

interface InpatientMedicationOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingOrders: InpatientMedicationOrder[];
  historyOrders: InpatientMedicationOrder[];
  legacyDispensedOrders?: LegacyDispensedTransaction[];
  subscriptionPlans?: SubscriptionMedicationPlan[];
  selectedOrders: Set<string>;
  onToggleOrder: (orderName: string) => void;
  onAddToCart: (alternatives?: Record<string, string>) => void;
  selectedHistoryItems: Set<string>;
  onToggleHistoryItem: (itemKey: string) => void;
  onAddHistoryItemsToCart: () => void;
  selectedLegacyItems?: Set<string>;
  onToggleLegacyItem?: (itemKey: string) => void;
  onAddLegacyItemsToCart?: (alternatives?: Record<string, string>) => void;
  selectedSubscriptionItems?: Set<string>;
  onToggleSubscriptionItem?: (itemKey: string) => void;
  onAddSubscriptionItemsToCart?: (alternatives?: Record<string, string>) => void;
  onCreateVisit: () => void;
  onSelectVisit?: (visit: { doctype: string; name: string; visit_type?: string | null }) => void;
  creatingVisit?: boolean;
  patientName?: string;
  patientId?: string;
  isHospitalMode?: boolean;
  defaultUom?: string;
  /** Shown on Patient Visit tab after a successful create/select (persists while modal can reopen). */
  lastCreatedVisit?: { doctype: string; name: string; visit_type?: string | null } | null;
  /** Incremented on each successful visit create/select — switches modal to Patient Visit tab. */
  patientVisitCreatedSignal?: number;
  patientHistory?: PatientHistorySummary | null;
  productAvailability?: Record<string, number>;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  Draft:        { label: "Draft",       classes: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 border border-gray-200 dark:border-gray-600" },
  Submitted:    { label: "Submitted",   classes: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-700" },
  Pending:      { label: "Pending",     classes: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700" },
  Signed:       { label: "Signed",      classes: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400 border border-sky-200 dark:border-sky-700" },
  Unsigned:     { label: "Unsigned",    classes: "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200 dark:border-orange-700" },
  "In Process": { label: "In Process",  classes: "bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 border border-violet-200 dark:border-violet-700" },
  Completed:    { label: "Completed",   classes: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700" },
  Cancelled:    { label: "Cancelled",   classes: "bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-700" },
};

function StatusBadge({ status, hideStatuses }: { status?: string; hideStatuses?: string[] }) {
  if (!status) return null;
  if (hideStatuses?.includes(status)) return null;
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
  dosage_form?: string;
  period?: string;
  instructions?: string;
  no_of_days?: number | string | null;
  route_of_administration?: string;
  date?: string;
  time?: string;
  end_date?: string;
  reference_no?: string;
  alternative_medicine?: string;
  alternative_medicine_name?: string;
  old_medicine_code?: string;
  old_medicine_name?: string;
  medication?: string;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatMedicationSecondaryDetails(item: ItemRow): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];

  if (hasText(item.instructions)) {
    details.push({ label: "Instructions", value: item.instructions.trim() });
  }
  if (hasText(item.dosage_form)) {
    details.push({ label: "Dosage form", value: item.dosage_form.trim() });
  }
  if (hasText(item.period)) {
    details.push({ label: "Period", value: item.period.trim() });
  }
  if (item.no_of_days != null && item.no_of_days !== "") {
    details.push({ label: "No. of days", value: String(item.no_of_days) });
  }
  if (hasText(item.route_of_administration)) {
    details.push({ label: "Route", value: item.route_of_administration.trim() });
  }
  if (hasText(item.date)) {
    details.push({ label: "Start date", value: item.date.trim() });
  }
  if (hasText(item.time)) {
    details.push({ label: "Time", value: item.time.trim() });
  }
  if (hasText(item.end_date)) {
    details.push({ label: "End date", value: item.end_date.trim() });
  }
  if (hasText(item.reference_no)) {
    details.push({ label: "Reference no.", value: item.reference_no.trim() });
  }
  if (hasText(item.alternative_medicine)) {
    const altLabel = hasText(item.alternative_medicine_name)
      ? `${item.alternative_medicine_name.trim()} (${item.alternative_medicine.trim()})`
      : item.alternative_medicine.trim();
    details.push({ label: "Alternative", value: altLabel });
  }
  if (hasText(item.old_medicine_code) && item.old_medicine_code.trim() !== (item.drug || "").trim()) {
    details.push({ label: "Old medicine code", value: item.old_medicine_code.trim() });
  }
  if (hasText(item.old_medicine_name) && item.old_medicine_name.trim() !== (item.drug_name || "").trim()) {
    details.push({ label: "Old medicine name", value: item.old_medicine_name.trim() });
  }
  if (hasText(item.medication) && item.medication.trim() !== (item.drug_name || "").trim()) {
    details.push({ label: "Medication", value: item.medication.trim() });
  }

  return details;
}

function medicationLineKey(orderName: string | undefined, idx: number, item: ItemRow): string {
  return `${orderName}::${idx}::${resolveMedicationItemCode(item)}`;
}

function medicationLineLabel(item: ItemRow): string {
  return resolveMedicationDisplayName(item);
}

function MedicationDrugCell({ item }: { item: ItemRow }) {
  const label = medicationLineLabel(item);
  const details = useMemo(
    () => formatMedicationSecondaryDetails(item),
    [
      item.instructions,
      item.dosage_form,
      item.period,
      item.no_of_days,
      item.route_of_administration,
      item.date,
      item.time,
      item.end_date,
      item.reference_no,
      item.alternative_medicine,
      item.alternative_medicine_name,
      item.old_medicine_code,
      item.old_medicine_name,
      item.medication,
      item.drug,
      item.drug_name,
    ]
  );
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 8;
    const margin = 8;

    const spaceAbove = triggerRect.top - margin;
    const spaceBelow = window.innerHeight - triggerRect.bottom - margin;

    let top: number;
    if (spaceBelow >= tooltipRect.height + gap || spaceBelow >= spaceAbove) {
      top = triggerRect.bottom + gap;
    } else {
      top = triggerRect.top - tooltipRect.height - gap;
    }

    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

    let left = triggerRect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

    setCoords((prev) => {
      if (prev?.top === top && prev?.left === left) return prev;
      return { top, left };
    });
  }, []);

  useLayoutEffect(() => {
    if (!hovered) return;
    updatePosition();
  }, [hovered, details, updatePosition]);

  useEffect(() => {
    if (!hovered) return;
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [hovered, updatePosition]);

  if (!details.length) {
    return <span>{label}</span>;
  }

  const tooltip =
    hovered && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            className="fixed z-[10100] w-max min-w-[16rem] max-w-sm pointer-events-none"
            style={{
              top: coords?.top ?? 0,
              left: coords?.left ?? 0,
              visibility: coords ? "visible" : "hidden",
            }}
          >
            <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 shadow-lg text-left">
              <div className="space-y-1.5">
                {details.map(({ label: detailLabel, value }) => (
                  <div key={detailLabel}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      {detailLabel}
                    </div>
                    <div className="text-[11px] text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
          setCoords(null);
        }}
        className="cursor-help underline decoration-dotted decoration-gray-300 dark:decoration-gray-600 underline-offset-2"
      >
        {label}
      </span>
      {tooltip}
    </>
  );
}

// ── Alternative drug search modal ─────────────────────────────────────────────
function AlternativeDrugSearchModal({
  isOpen,
  onClose,
  drugCode,
  drugName,
  value,
  onChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  drugCode: string;
  drugName?: string;
  value: string;
  onChange: (value: string, itemName?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [options, setOptions] = useState<ItemAlternativeOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setDebouncedQuery("");
      setOptions([]);
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [isOpen, query]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);

    void searchPosStockItemsForAlternative(debouncedQuery, drugCode || undefined).then((results) => {
      if (cancelled) return;
      setOptions(results);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, debouncedQuery, drugCode]);

  if (!isOpen) return null;

  const handleSelect = (itemCode: string, itemName?: string) => {
    onChange(itemCode, itemName);
    onClose();
  };

  const modal = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Select alternative drug</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
              For: <span className="font-medium text-gray-700 dark:text-gray-300">{drugName || drugCode}</span>
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
              Showing in-stock items from this POS profile
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by item name or code…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">Loading items…</div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleSelect("")}
                className={`w-full text-left px-3 py-3 rounded-lg mb-1 transition-colors ${
                  !value
                    ? "bg-orange-50 dark:bg-orange-900/20 ring-1 ring-orange-200 dark:ring-orange-800"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {value ? "Remove alternative" : "No alternative"}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {value
                    ? "Clear the mapped drug and use the original line only"
                    : "Use the prescribed / original drug only"}
                </div>
              </button>
              {options.length > 0 ? (
                options.map((opt) => (
                  <button
                    key={opt.item_code}
                    type="button"
                    onClick={() => handleSelect(opt.item_code, opt.item_name)}
                    className={`w-full text-left px-3 py-3 rounded-lg mb-1 transition-colors ${
                      value === opt.item_code
                        ? "bg-orange-50 dark:bg-orange-900/20 ring-1 ring-orange-200 dark:ring-orange-800"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{opt.item_name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-3">
                      <span className="font-mono">{opt.item_code}</span>
                      <span>Stock: {opt.available}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="py-10 text-center text-sm text-gray-500">
                  {debouncedQuery.trim() ? "No matching in-stock items" : "No in-stock items available"}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}

// ── Alternative drug cell: compact label + search / clear ────────────────────
function AlternativeDrugSelect({
  drugCode,
  drugName,
  value,
  selectedLabel,
  lowStock,
  onChange,
}: {
  drugCode?: string;
  drugName?: string;
  value: string;
  selectedLabel?: string;
  lowStock: boolean;
  onChange: (value: string, itemName?: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const searchKey = (drugCode || "").trim() || "__legacy__";
  const displayLabel = value ? selectedLabel || value : "";

  return (
    <>
      {/* Fixed width so one long alt name cannot stretch the column for other rows */}
      <div className="flex items-center gap-1 w-[152px] max-w-[152px]">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`flex-1 min-w-0 overflow-hidden text-left truncate text-xs rounded-md px-1.5 py-1 border transition-colors ${
            value
              ? "border-orange-200 dark:border-orange-800 bg-orange-50/60 dark:bg-orange-900/15 text-gray-800 dark:text-gray-200 font-medium hover:bg-orange-50 dark:hover:bg-orange-900/25"
              : lowStock
              ? "border-transparent text-amber-700 dark:text-amber-400 hover:bg-amber-50/40 dark:hover:bg-amber-900/10"
              : "border-transparent text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
          title={value ? `${displayLabel} (${value}) — click to change` : "Search alternative drug"}
        >
          {value ? displayLabel : lowStock ? "Required" : "—"}
        </button>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title={value ? "Change alternative" : "Search alternative drug"}
          className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md border transition-colors ${
            lowStock && !value
              ? "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700"
              : value
              ? "border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 text-orange-600 hover:bg-orange-100"
              : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
          <Search size={14} />
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Remove alternative"
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 hover:text-red-600 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <X size={14} />
          </button>
        ) : (
          // Keep search button position aligned across rows when no clear button
          <span className="flex-shrink-0 w-7 h-7" aria-hidden />
        )}
      </div>

      <AlternativeDrugSearchModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        drugCode={searchKey}
        drugName={drugName}
        value={value}
        onChange={onChange}
      />
    </>
  );
}

function formatMedicationQty(item: ItemRow) {
  if (item.quantity == null) return "—";
  // Only show UOM when it exists on the medication order line (no POS default fallback).
  const uom = item.uom?.trim() || "";
  return `${item.quantity}${uom ? ` ${uom}` : ""}`;
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
  alternativeDrugLabels,
  onAlternativeChange,
  showDetailsOnHover,
  hospitalMode,
  defaultUom: _defaultUom,
}: {
  items: ItemRow[];
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggle?: (key: string) => void;
  orderName?: string;
  productAvailability?: Record<string, number>;
  alternativeDrugs?: Record<string, string>;
  alternativeDrugLabels?: Record<string, string>;
  onAlternativeChange?: (key: string, value: string, itemName?: string) => void;
  showDetailsOnHover?: boolean;
  hospitalMode?: boolean;
  defaultUom?: string;
}) {
  if (!items.length) return null;
  const isPrn = (v: ItemRow["is_prn"]) => v === 1 || v === true || v === "1";

  return (
    <div className={`rounded-lg border border-gray-200 dark:border-gray-700 text-xs ${showDetailsOnHover ? "overflow-visible" : "overflow-hidden"}`}>
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
            {onAlternativeChange && (
              <th className="px-2 py-2 text-left w-[160px] min-w-[160px] max-w-[160px]">Alt. Drug</th>
            )}
           </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {items.map((item, idx) => {
            const itemKey = medicationLineKey(orderName, idx, item);
            const lineCode = resolveMedicationItemCode(item);
            const checked = selectedKeys?.has(itemKey) ?? false;
            const avail = lineCode ? productAvailability?.[lineCode] : undefined;
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
                  {showDetailsOnHover ? <MedicationDrugCell item={item} /> : medicationLineLabel(item)}
                 </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {item.dosage || "—"}
                 </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {formatMedicationQty(item)}
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
                  <td
                    className="px-2 py-2 w-[160px] min-w-[160px] max-w-[160px] overflow-hidden align-middle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlternativeDrugSelect
                      drugCode={lineCode}
                      drugName={medicationLineLabel(item)}
                      value={alternativeDrugs?.[itemKey] || ""}
                      selectedLabel={alternativeDrugLabels?.[itemKey]}
                      lowStock={!!lowStock}
                      onChange={(next, itemName) => onAlternativeChange?.(itemKey, next, itemName)}
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

function resolvePatientFileUrl(path?: string | null): string {
  if (!path?.trim()) return "";
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

function openPatientUploadDocument(url: string, print = false) {
  const fullUrl = resolvePatientFileUrl(url);
  if (!fullUrl) return;
  const popup = window.open(fullUrl, "_blank", "noopener,noreferrer");
  if (print && popup) {
    popup.addEventListener("load", () => {
      try {
        popup.print();
      } catch {
        /* ignore */
      }
    });
  }
}

function getUploadDocumentLabel(doc: PatientUploadDocument): string {
  return doc.file_name?.trim() || doc.document_name?.trim() || doc.document_type?.trim() || "Document";
}

function formatLegacyAmount(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function LegacyItemsTable({
  items,
  txnName,
  selectable,
  selectedKeys,
  onToggle,
  productAvailability,
  alternativeDrugs,
  alternativeDrugLabels,
  onAlternativeChange,
}: {
  items: LegacyDispensedMedicationItem[];
  txnName: string;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggle?: (key: string) => void;
  productAvailability?: Record<string, number>;
  alternativeDrugs?: Record<string, string>;
  alternativeDrugLabels?: Record<string, string>;
  onAlternativeChange?: (key: string, value: string, itemName?: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <tr>
            {selectable && <th className="px-3 py-2 w-8" />}
            <th className="px-3 py-2 text-left font-semibold">#</th>
            <th className="px-3 py-2 text-left font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-left font-semibold">UOM</th>
            <th className="px-3 py-2 text-right font-semibold">Rate</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
            <th className="px-3 py-2 text-left font-semibold">Batch</th>
            <th className="px-3 py-2 text-left font-semibold">Expiry</th>
            {productAvailability && <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Stock</th>}
            {onAlternativeChange && (
              <th className="px-2 py-2 text-left font-semibold w-[160px] min-w-[160px] max-w-[160px]">
                Alt. Drug
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-gray-900/40">
          {items.map((item, idx) => {
            const itemKey = legacyMedicationLineKey(txnName, idx, item);
            const lineCode = resolveLegacyMedicationItemCode(item);
            const altCode = alternativeDrugs?.[itemKey]?.trim() || "";
            const checked = selectedKeys?.has(itemKey) ?? false;
            const stockCode = altCode || lineCode;
            const avail = stockCode ? productAvailability?.[stockCode] : undefined;
            const qty = Number(item.show_qty || 1) || 1;
            // Legacy codes often are not current Items — treat missing/zero stock as needing an alternative.
            const needsAlternative =
              !altCode && (avail === undefined || avail <= 0 || avail < qty);
            const lowStock = !!altCode && avail !== undefined && (avail <= 0 || avail < qty);
            return (
              <tr
                key={item.name || `${item.item_num || "item"}-${idx}`}
                onClick={selectable && onToggle ? () => onToggle(itemKey) : undefined}
                className={`transition-colors ${selectable ? "cursor-pointer" : ""} ${
                  checked
                    ? "bg-orange-50 dark:bg-orange-900/20"
                    : selectable
                      ? "hover:bg-orange-50/50 dark:hover:bg-orange-900/10"
                      : ""
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
                <td className="px-3 py-2 text-slate-500 tabular-nums">{item.sr_num ?? idx + 1}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900 dark:text-white">
                    {resolveLegacyMedicationDisplayName(item)}
                  </div>
                  {lineCode ? (
                    <div className="text-xs text-slate-400 font-mono mt-0.5">{lineCode}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                  {formatLegacyAmount(item.show_qty)}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{item.show_uom || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                  {formatLegacyAmount(item.show_rate)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900 dark:text-white">
                  {formatLegacyAmount(item.show_amt)}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono text-xs">
                  {item.ais_batch_num || "—"}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 tabular-nums text-xs">
                  {item.item_expiry_date ? String(item.item_expiry_date).slice(0, 10) : "—"}
                </td>
                {productAvailability && (
                  <td
                    className={`px-3 py-2 whitespace-nowrap ${
                      lowStock
                        ? "text-red-600 font-semibold"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {avail === undefined ? (altCode ? "N/A" : "Map alt") : avail}
                  </td>
                )}
                {onAlternativeChange && (
                  <td
                    className="px-2 py-2 w-[160px] min-w-[160px] max-w-[160px] overflow-hidden align-middle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlternativeDrugSelect
                      drugCode={lineCode || undefined}
                      drugName={resolveLegacyMedicationDisplayName(item)}
                      value={altCode}
                      selectedLabel={alternativeDrugLabels?.[itemKey]}
                      lowStock={needsAlternative || lowStock}
                      onChange={(next, itemName) => onAlternativeChange?.(itemKey, next, itemName)}
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

function SubscriptionItemsTable({
  items,
  planName,
  selectable,
  selectedKeys,
  onToggle,
  productAvailability,
  alternativeDrugs,
  alternativeDrugLabels,
  onAlternativeChange,
}: {
  items: SubscriptionMedicationPlanItem[];
  planName: string;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggle?: (key: string) => void;
  productAvailability?: Record<string, number>;
  alternativeDrugs?: Record<string, string>;
  alternativeDrugLabels?: Record<string, string>;
  onAlternativeChange?: (key: string, value: string, itemName?: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-teal-200 dark:border-teal-800/50">
      <table className="min-w-full text-sm">
        <thead className="bg-teal-50 dark:bg-teal-900/30 text-xs uppercase tracking-wide text-teal-700/80 dark:text-teal-300/80">
          <tr>
            {selectable && <th className="px-3 py-2 w-8" />}
            <th className="px-3 py-2 text-left font-semibold">Drug</th>
            <th className="px-3 py-2 text-left font-semibold">Dosage</th>
            <th className="px-3 py-2 text-right font-semibold">Qty / cycle</th>
            <th className="px-3 py-2 text-left font-semibold">Frequency</th>
            <th className="px-3 py-2 text-center font-semibold">Active</th>
            {productAvailability && <th className="px-3 py-2 text-left font-semibold">Stock</th>}
            {onAlternativeChange && (
              <th className="px-2 py-2 text-left font-semibold w-[160px] min-w-[160px] max-w-[160px]">
                Alt. Drug
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-teal-100 dark:divide-teal-900/40 bg-white dark:bg-gray-900/40">
          {items.map((item, idx) => {
            const itemKey = subscriptionMedicationLineKey(planName, idx, item);
            const lineCode = resolveSubscriptionItemCode(item);
            const altCode = alternativeDrugs?.[itemKey]?.trim() || "";
            const checked = selectedKeys?.has(itemKey) ?? false;
            const stockCode = altCode || lineCode;
            const avail = stockCode ? productAvailability?.[stockCode] : undefined;
            const qty = Number(item.qty_per_cycle || 1) || 1;
            const needsAlternative =
              !altCode && (avail === undefined || avail <= 0 || avail < qty);
            const lowStock = !!altCode && avail !== undefined && (avail <= 0 || avail < qty);
            const inactive = item.is_active === 0;
            return (
              <tr
                key={item.name || `${lineCode}-${idx}`}
                onClick={selectable && onToggle && !inactive ? () => onToggle(itemKey) : undefined}
                className={`transition-colors ${selectable && !inactive ? "cursor-pointer" : ""} ${
                  inactive
                    ? "opacity-50"
                    : checked
                      ? "bg-orange-50 dark:bg-orange-900/20"
                      : selectable
                        ? "hover:bg-orange-50/50 dark:hover:bg-orange-900/10"
                        : ""
                }`}
              >
                {selectable && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={inactive}
                      onChange={() => onToggle?.(itemKey)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900 dark:text-white">
                    {resolveSubscriptionItemDisplayName(item)}
                  </div>
                  {lineCode ? (
                    <div className="text-xs text-slate-400 font-mono mt-0.5">{lineCode}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                  {item.dosage != null && item.dosage !== "" ? String(item.dosage) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                  {item.qty_per_cycle ?? 1}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                  {item.patient_frequency || "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  {inactive ? (
                    <span className="text-[10px] font-semibold text-gray-400">Off</span>
                  ) : (
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">On</span>
                  )}
                </td>
                {productAvailability && (
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">
                    {avail === undefined ? (altCode ? "N/A" : "Map alt") : avail}
                  </td>
                )}
                {onAlternativeChange && (
                  <td
                    className="px-2 py-2 w-[160px] min-w-[160px] max-w-[160px] overflow-hidden align-middle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlternativeDrugSelect
                      drugCode={lineCode || undefined}
                      drugName={resolveSubscriptionItemDisplayName(item)}
                      value={altCode}
                      selectedLabel={alternativeDrugLabels?.[itemKey]}
                      lowStock={needsAlternative || lowStock}
                      onChange={(next, itemName) => onAlternativeChange?.(itemKey, next, itemName)}
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

export default function InpatientMedicationOrdersModal({
  isOpen,
  onClose,
  pendingOrders,
  historyOrders,
  legacyDispensedOrders = [],
  subscriptionPlans = [],
  selectedOrders,
  onToggleOrder,
  onAddToCart,
  selectedHistoryItems,
  onToggleHistoryItem,
  onAddHistoryItemsToCart,
  selectedLegacyItems = new Set(),
  onToggleLegacyItem,
  onAddLegacyItemsToCart,
  selectedSubscriptionItems = new Set(),
  onToggleSubscriptionItem,
  onAddSubscriptionItemsToCart,
  onCreateVisit,
  onSelectVisit,
  creatingVisit = false,
  patientName,
  patientId,
  isHospitalMode = false,
  defaultUom,
  lastCreatedVisit = null,
  patientVisitCreatedSignal = 0,
  patientHistory = null,
  productAvailability = {},
}: InpatientMedicationOrdersModalProps) {
  const [activeTab, setActiveTab] = useState<"pending" | "history" | "visit" | "patient_history" | "legacy_dispensed" | "monthly_medication">("pending");
  const [alternativeDrugs, setAlternativeDrugs] = useState<Record<string, string>>({});
  const [alternativeDrugLabels, setAlternativeDrugLabels] = useState<Record<string, string>>({});
  const [legacyAlternativeDrugs, setLegacyAlternativeDrugs] = useState<Record<string, string>>({});
  const [legacyAlternativeDrugLabels, setLegacyAlternativeDrugLabels] = useState<Record<string, string>>({});
  const [subscriptionAlternativeDrugs, setSubscriptionAlternativeDrugs] = useState<Record<string, string>>({});
  const [subscriptionAlternativeDrugLabels, setSubscriptionAlternativeDrugLabels] = useState<Record<string, string>>({});
  const [expandedHistoryOrders, setExpandedHistoryOrders] = useState<Set<string>>(new Set());
  const [expandedLegacyOrders, setExpandedLegacyOrders] = useState<Set<string>>(new Set());
  const [expandedSubscriptionPlans, setExpandedSubscriptionPlans] = useState<Set<string>>(new Set());
  const [reminderPlan, setReminderPlan] = useState<SubscriptionMedicationPlan | null>(null);
  const [expandedDiagnosisEntries, setExpandedDiagnosisEntries] = useState<Set<string>>(new Set());
  const [expandedPatientHistoryOrders, setExpandedPatientHistoryOrders] = useState<Set<string>>(new Set());
  const [openPrintMenuFor, setOpenPrintMenuFor] = useState<string | null>(null);
  const [printMenuPosition, setPrintMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [medicationOrderPrintFormats, setMedicationOrderPrintFormats] = useState<string[]>(["Standard"]);
  const [openPharmacyVisits, setOpenPharmacyVisits] = useState<OpenPharmacyPatientVisit[]>([]);
  const [loadingOpenVisits, setLoadingOpenVisits] = useState(false);
  const printButtonRef = useRef<HTMLButtonElement | null>(null);

  const MEDICATION_ORDER_DOCTYPE = "Patient Medication Order";

  const loadOpenPharmacyVisits = useCallback(async () => {
    if (!patientId || !isHospitalMode) {
      setOpenPharmacyVisits([]);
      return;
    }
    setLoadingOpenVisits(true);
    try {
      const visits = await getOpenPharmacyPatientVisits(patientId);
      setOpenPharmacyVisits(visits);
    } finally {
      setLoadingOpenVisits(false);
    }
  }, [patientId, isHospitalMode]);

  useEffect(() => {
    if (!isOpen) {
      setActiveTab("pending");
      setExpandedHistoryOrders(new Set());
      setExpandedLegacyOrders(new Set());
      setExpandedSubscriptionPlans(new Set());
      setExpandedDiagnosisEntries(new Set());
      setExpandedPatientHistoryOrders(new Set());
      setOpenPrintMenuFor(null);
      setPrintMenuPosition(null);
      setAlternativeDrugs({});
      setAlternativeDrugLabels({});
      setLegacyAlternativeDrugs({});
      setLegacyAlternativeDrugLabels({});
      setSubscriptionAlternativeDrugs({});
      setSubscriptionAlternativeDrugLabels({});
      setOpenPharmacyVisits([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isHospitalMode || !patientId) return;
    void loadOpenPharmacyVisits();
  }, [isOpen, isHospitalMode, patientId, loadOpenPharmacyVisits, patientVisitCreatedSignal]);

  // Legacy transactions open by default (each has a child table).
  useEffect(() => {
    if (!isOpen) return;
    setExpandedLegacyOrders(new Set(legacyDispensedOrders.map((t) => t.name)));
  }, [isOpen, legacyDispensedOrders]);

  // Subscription plans open by default.
  useEffect(() => {
    if (!isOpen) return;
    setExpandedSubscriptionPlans(new Set(subscriptionPlans.map((p) => p.name)));
  }, [isOpen, subscriptionPlans]);

  useEffect(() => {
    if (!isOpen) setReminderPlan(null);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isHospitalMode && patientVisitCreatedSignal > 0) {
      setActiveTab("visit");
    }
  }, [isOpen, isHospitalMode, patientVisitCreatedSignal]);

  useEffect(() => {
    if (!isOpen) return;
    void getPrintFormatsForDoctype(MEDICATION_ORDER_DOCTYPE).then(({ formats }) => {
      setMedicationOrderPrintFormats(formats.length ? formats : ["Standard"]);
    });
  }, [isOpen]);

  const openDocPrint = (doctype: string, name: string, format = "Standard") => {
    const params = new URLSearchParams();
    params.set("doctype", doctype);
    params.set("name", name);
    params.set("format", format);
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
            className="fixed z-[9999] min-w-[180px] max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
            style={{ top: printMenuPosition.top, right: printMenuPosition.right, left: "auto" }}
          >
            {medicationOrderPrintFormats.map((format) => (
              <button
                key={format}
                type="button"
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => {
                  openPrint(MEDICATION_ORDER_DOCTYPE, openPrintMenuFor, format);
                  setOpenPrintMenuFor(null);
                }}
              >
                <Printer size={13} className="text-slate-400 flex-shrink-0" />
                <span className="truncate">{format}</span>
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  if (!isOpen) return null;

  const tabs = [
    { id: "pending" as const, label: "Pending", count: pendingOrders.length, icon: ClipboardList },
    { id: "visit" as const, label: "Patient Visit", count: null, icon: UserPlus },
    { id: "history" as const, label: "Prescription History", count: historyOrders.length, icon: Clock },
    { id: "patient_history" as const, label: "Patient History", count: null, icon: History },
    { id: "legacy_dispensed" as const, label: "Legacy Dispensed Medicine", count: legacyDispensedOrders.length, icon: Package },
    { id: "monthly_medication" as const, label: "Monthly Medication", count: subscriptionPlans.length, icon: CalendarDays },
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
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{order.name}</h3>
                          <DispenseVisitTypeBadge
                            visitType={order.visit_type}
                            referenceType={order.custom_reference_type}
                          />
                          <MedicationOrderDischargedBadge afterDischarge={order.after_discharge} />
                        </div>
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
                            showDetailsOnHover
                            hospitalMode={isHospitalMode}
                            defaultUom={defaultUom}
                            productAvailability={productAvailability}
                            alternativeDrugs={alternativeDrugs}
                            alternativeDrugLabels={alternativeDrugLabels}
                            onAlternativeChange={(key, value, itemName) => {
                              setAlternativeDrugs((prev) => {
                                const next = { ...prev };
                                if (value) next[key] = value;
                                else delete next[key];
                                return next;
                              });
                              setAlternativeDrugLabels((prev) => {
                                const next = { ...prev };
                                if (value && itemName) next[key] = itemName;
                                else delete next[key];
                                return next;
                              });
                            }}
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
                <p className="text-sm font-medium">No prescription history found.</p>
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
                          <DispenseVisitTypeBadge
                            visitType={order.visit_type}
                            referenceType={order.custom_reference_type}
                          />
                          <MedicationOrderDischargedBadge afterDischarge={order.after_discharge} />
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
                          <StatusBadge
                            status={order.status}
                            hideStatuses={["Draft", "Completed", "Unsigned"]}
                          />
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
                            hospitalMode={isHospitalMode}
                            defaultUom={defaultUom}
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
                  {patientHistory?.patient?.id_number ? <div><span className="text-gray-500">CPR / ID:</span> {String(patientHistory.patient.id_number)}</div> : null}
                  {patientHistory?.patient?.sex ? <div><span className="text-gray-500">Sex:</span> {String(patientHistory.patient.sex)}</div> : null}
                  {patientHistory?.patient?.dob ? <div><span className="text-gray-500">DOB:</span> {String(patientHistory.patient.dob).slice(0, 10)}</div> : null}
                  {patientHistory?.patient?.blood_group ? <div><span className="text-gray-500">Blood:</span> {String(patientHistory.patient.blood_group)}</div> : null}
                  {patientHistory?.patient?.mobile ? <div><span className="text-gray-500">Mobile:</span> {String(patientHistory.patient.mobile)}</div> : null}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
                  <FileText size={15} className="text-gray-500" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Patient Documents</h3>
                </div>
                {(patientHistory?.patient_documents || []).length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No documents on file for this patient.</div>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {(patientHistory?.patient_documents || []).map((doc, index) => {
                      const label = getUploadDocumentLabel(doc);
                      return (
                        <li key={doc.name || `doc-${index}`} className="px-4 py-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{label}</p>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                              {doc.document_type ? <span>Type: {doc.document_type}</span> : null}
                              {doc.transaction_no ? <span>Txn: {doc.transaction_no}</span> : null}
                            </div>
                            {doc.upload_remarks ? (
                              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{doc.upload_remarks}</p>
                            ) : null}
                          </div>
                          {doc.document ? (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => openPatientUploadDocument(doc.document!, false)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                <ExternalLink size={13} />
                                Open
                              </button>
                              <button
                                type="button"
                                onClick={() => openPatientUploadDocument(doc.document!, true)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-600 hover:text-orange-700 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20"
                              >
                                <Printer size={13} />
                                Print
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">No file</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
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
                            <StatusBadge
                            status={order.status}
                            hideStatuses={["Draft", "Completed", "Unsigned"]}
                          />
                          </button>
                          {isExpanded && order.items && order.items.length > 0 && (
                            <div className="px-4 py-3 border-t border-orange-200 dark:border-orange-800/40 bg-white/70 dark:bg-gray-900/20">
                              <ItemsTable
                                items={order.items}
                                orderName={order.name}
                                hospitalMode={isHospitalMode}
                                defaultUom={defaultUom}
                              />
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

          {/* ── LEGACY DISPENSED MEDICINE ── */}
          {isHospitalMode && activeTab === "legacy_dispensed" && (
            legacyDispensedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
                <Package size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-medium">No legacy dispensed medicine found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {legacyDispensedOrders.map((txn) => {
                  const isExpanded = expandedLegacyOrders.has(txn.name);
                  const title = txn.trans_no || txn.name;
                  const dateLabel = txn.trans_date
                    ? String(txn.trans_date).slice(0, 10)
                    : txn.date_created
                      ? String(txn.date_created).slice(0, 10)
                      : null;
                  return (
                    <div
                      key={txn.name}
                      className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/20"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLegacyOrders((prev) => {
                            const next = new Set(prev);
                            next.has(txn.name) ? next.delete(txn.name) : next.add(txn.name);
                            return next;
                          })
                        }
                        className="w-full flex items-center gap-2 px-4 py-3 bg-slate-100/80 dark:bg-slate-800/50 text-left"
                      >
                        <span className={`text-gray-400 transition-transform duration-150 flex-shrink-0 ${isExpanded ? "rotate-0" : "-rotate-90"}`}>
                          <ChevronDown size={15} />
                        </span>
                        <span className="font-semibold text-sm text-gray-800 dark:text-white truncate font-mono">
                          {title}
                        </span>
                        {dateLabel ? (
                          <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">{dateLabel}</span>
                        ) : null}
                        {txn.branch ? (
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-shrink-0">
                            {txn.branch}
                          </span>
                        ) : null}
                        {txn.visit_num || txn.patient_visit ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 flex-shrink-0">
                            Visit {txn.visit_num || txn.patient_visit}
                          </span>
                        ) : null}
                        {txn.admission_num || txn.admission ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex-shrink-0">
                            Adm {txn.admission_num || txn.admission}
                          </span>
                        ) : null}
                        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                          {(txn.item_count ?? txn.items?.length ?? 0)} item(s)
                          {txn.net_bill_amount != null ? ` · ${formatLegacyAmount(txn.net_bill_amount)}` : ""}
                        </span>
                      </button>

                      {isExpanded && (txn.items?.length ?? 0) > 0 && (
                        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-gray-900/30">
                          <LegacyItemsTable
                            items={txn.items}
                            txnName={txn.name}
                            selectable={!!onToggleLegacyItem}
                            selectedKeys={selectedLegacyItems}
                            onToggle={onToggleLegacyItem}
                            productAvailability={productAvailability}
                            alternativeDrugs={legacyAlternativeDrugs}
                            alternativeDrugLabels={legacyAlternativeDrugLabels}
                            onAlternativeChange={(key, value, itemName) => {
                              setLegacyAlternativeDrugs((prev) => {
                                const next = { ...prev };
                                if (value) next[key] = value;
                                else delete next[key];
                                return next;
                              });
                              setLegacyAlternativeDrugLabels((prev) => {
                                const next = { ...prev };
                                if (value && itemName) next[key] = itemName;
                                else delete next[key];
                                return next;
                              });
                            }}
                          />
                          {txn.trans_remarks ? (
                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">
                              {txn.trans_remarks}
                            </p>
                          ) : null}
                        </div>
                      )}

                      {isExpanded && (!txn.items || txn.items.length === 0) && (
                        <div className="px-4 py-4 border-t border-slate-200 dark:border-slate-700 text-sm text-gray-400 dark:text-gray-500 text-center bg-white/80 dark:bg-gray-900/30">
                          No line items on this transaction.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ── MONTHLY MEDICATION (Subscription Medication Plan) ── */}
          {isHospitalMode && activeTab === "monthly_medication" && (
            subscriptionPlans.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
                <CalendarDays size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-medium">No monthly medication plans found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {subscriptionPlans.map((plan) => {
                  const isExpanded = expandedSubscriptionPlans.has(plan.name);
                  const startLabel = plan.start_date ? String(plan.start_date).slice(0, 10) : null;
                  const nextLabel = plan.next_run_date ? String(plan.next_run_date).slice(0, 10) : null;
                  return (
                    <div
                      key={plan.name}
                      className="border border-teal-200 dark:border-teal-800/50 rounded-xl overflow-hidden bg-teal-50/40 dark:bg-teal-950/20"
                    >
                      <div className="w-full flex items-center gap-2 px-4 py-3 bg-teal-100/70 dark:bg-teal-900/30 transition-colors hover:bg-teal-200/60 dark:hover:bg-teal-900/50">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSubscriptionPlans((prev) => {
                              const next = new Set(prev);
                              next.has(plan.name) ? next.delete(plan.name) : next.add(plan.name);
                              return next;
                            })
                          }
                          className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-lg"
                        >
                          <span className={`text-teal-500 transition-transform duration-150 flex-shrink-0 ${isExpanded ? "rotate-0" : "-rotate-90"}`}>
                            <ChevronDown size={15} />
                          </span>
                          <span className="font-semibold text-sm text-gray-800 dark:text-white truncate font-mono">
                            {plan.name}
                          </span>
                          {plan.frequency ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-teal-200/80 dark:bg-teal-800/50 text-teal-800 dark:text-teal-200 flex-shrink-0">
                              {plan.frequency}
                            </span>
                          ) : null}
                          {plan.status ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex-shrink-0">
                              {plan.status}
                            </span>
                          ) : null}
                          {startLabel ? (
                            <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">Start {startLabel}</span>
                          ) : null}
                          {nextLabel ? (
                            <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">Next {nextLabel}</span>
                          ) : null}
                          {(plan.practitioner_name || plan.practitioner) ? (
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-shrink-0">
                              {plan.practitioner_name || plan.practitioner}
                            </span>
                          ) : null}
                          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                            {(plan.item_count ?? plan.medications?.length ?? 0)} med(s)
                          </span>
                        </button>
                        <button
                          type="button"
                          title="Send WhatsApp reminder"
                          onClick={() => setReminderPlan(plan)}
                          className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors"
                        >
                          <MessageCircle size={14} />
                          Reminder
                        </button>
                      </div>

                      {isExpanded && (plan.medications?.length ?? 0) > 0 && (
                        <div className="px-4 py-3 border-t border-teal-200 dark:border-teal-800/50 bg-white/80 dark:bg-gray-900/30">
                          <SubscriptionItemsTable
                            items={plan.medications}
                            planName={plan.name}
                            selectable={!!onToggleSubscriptionItem}
                            selectedKeys={selectedSubscriptionItems}
                            onToggle={onToggleSubscriptionItem}
                            productAvailability={productAvailability}
                            alternativeDrugs={subscriptionAlternativeDrugs}
                            alternativeDrugLabels={subscriptionAlternativeDrugLabels}
                            onAlternativeChange={(key, value, itemName) => {
                              setSubscriptionAlternativeDrugs((prev) => {
                                const next = { ...prev };
                                if (value) next[key] = value;
                                else delete next[key];
                                return next;
                              });
                              setSubscriptionAlternativeDrugLabels((prev) => {
                                const next = { ...prev };
                                if (value && itemName) next[key] = itemName;
                                else delete next[key];
                                return next;
                              });
                            }}
                          />
                        </div>
                      )}

                      {isExpanded && (!plan.medications || plan.medications.length === 0) && (
                        <div className="px-4 py-4 border-t border-teal-200 dark:border-teal-800/50 text-sm text-gray-400 dark:text-gray-500 text-center bg-white/80 dark:bg-gray-900/30">
                          No medications on this plan.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
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
                      <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Patient visit ready</p>
                      <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80 mt-1">
                        This visit is linked when you press <span className="font-semibold">Dispense</span> on the cart.
                      </p>
                      <div className="mt-3 space-y-1.5 text-sm">
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/70">Type</span>
                          <span className="font-mono text-emerald-900 dark:text-emerald-100">
                            {lastCreatedVisit.visit_type || "—"}
                          </span>
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
                <div className="px-6 py-4 bg-sky-50 dark:bg-sky-900/20 border-b border-sky-100 dark:border-sky-800/30">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-sky-600 flex items-center justify-center">
                      <ClipboardList size={17} className="text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white text-base">
                        Open Pharmacy visits
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Reuse a visit already opened by reception — avoids duplicates
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3">
                  {!patientId ? (
                    <p className="text-sm text-gray-500 px-2 py-3">Select a patient to see open Pharmacy visits.</p>
                  ) : loadingOpenVisits ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
                      <span className="w-4 h-4 border-2 border-sky-600/30 border-t-sky-600 rounded-full animate-spin" />
                      Loading open visits…
                    </div>
                  ) : openPharmacyVisits.length === 0 ? (
                    <p className="text-sm text-gray-500 px-2 py-3">
                      No open Pharmacy visits for this patient. Create one below if needed.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {openPharmacyVisits.map((visit) => {
                        const visitDate = String(
                          visit.encounter_date || visit.visit_date || visit.posting_date || ""
                        ).slice(0, 10);
                        const isSelected = lastCreatedVisit?.name === visit.name;
                        return (
                          <div
                            key={visit.name}
                            className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
                              isSelected
                                ? "border-emerald-400 bg-emerald-50/70 dark:border-emerald-700 dark:bg-emerald-900/20"
                                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-sm font-semibold text-gray-900 dark:text-white break-all">
                                {visit.name}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                {visitDate ? <span>Date: <span className="tabular-nums font-medium text-gray-700 dark:text-gray-200">{visitDate}</span></span> : null}
                                {visit.status ? <span>Status: <span className="font-medium text-gray-700 dark:text-gray-200">{visit.status}</span></span> : null}
                                {visit.visit_type ? <span>Type: <span className="font-medium text-gray-700 dark:text-gray-200">{visit.visit_type}</span></span> : null}
                              </div>
                              {visit.practitioner_name ? (
                                <div className="mt-1 text-xs text-gray-500">
                                  Practitioner: <span className="font-medium text-gray-700 dark:text-gray-200">{visit.practitioner_name}</span>
                                </div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              disabled={!onSelectVisit || isSelected}
                              onClick={() =>
                                onSelectVisit?.({
                                  doctype: visit.doctype || "Patient Visit",
                                  name: visit.name,
                                  visit_type: visit.visit_type || null,
                                })
                              }
                              className={`flex-shrink-0 px-3 py-2 text-xs font-bold rounded-lg border-2 transition-colors ${
                                isSelected
                                  ? "border-emerald-500 text-emerald-700 bg-emerald-100 cursor-default"
                                  : "border-sky-600 text-sky-700 bg-white hover:bg-sky-50 disabled:opacity-50"
                              }`}
                            >
                              {isSelected ? "Selected" : "Use visit"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

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
                        Only if there is no open Pharmacy visit to reuse
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
              : activeTab === "legacy_dispensed"
              ? `${selectedLegacyItems.size} legacy item(s) selected`
              : activeTab === "monthly_medication"
              ? `${selectedSubscriptionItems.size} monthly item(s) selected`
              : lastCreatedVisit?.name
              ? "Visit linked — used when you dispense"
              : openPharmacyVisits.length > 0
              ? "Select an open Pharmacy visit, or create a new one"
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
            {isHospitalMode && activeTab === "legacy_dispensed" && onAddLegacyItemsToCart && (
              <button
                onClick={() => onAddLegacyItemsToCart(legacyAlternativeDrugs)}
                disabled={selectedLegacyItems.size === 0}
                className="px-5 py-2 text-sm font-bold text-orange-600 bg-white border-2 border-orange-600 rounded-lg hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-[0.99]"
              >
                Add Selected {selectedLegacyItems.size > 0 && `(${selectedLegacyItems.size})`}
              </button>
            )}
            {isHospitalMode && activeTab === "monthly_medication" && onAddSubscriptionItemsToCart && (
              <button
                onClick={() => onAddSubscriptionItemsToCart(subscriptionAlternativeDrugs)}
                disabled={selectedSubscriptionItems.size === 0}
                className="px-5 py-2 text-sm font-bold text-orange-600 bg-white border-2 border-orange-600 rounded-lg hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-[0.99]"
              >
                Add Selected {selectedSubscriptionItems.size > 0 && `(${selectedSubscriptionItems.size})`}
              </button>
            )}
          </div>
        </div>

        {printMenu}

        {reminderPlan && (
          <SendSubscriptionMedicationWhatsAppModal
            plan={reminderPlan}
            onClose={() => setReminderPlan(null)}
            onSuccess={() => {
              toast.success(
                `WhatsApp reminder sent to ${reminderPlan.patient_name || patientName || reminderPlan.patient || reminderPlan.name}`
              );
            }}
          />
        )}
      </div>
    </div>
  );
}