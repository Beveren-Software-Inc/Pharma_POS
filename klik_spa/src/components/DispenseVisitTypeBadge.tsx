import { resolveDispenseVisitType, type DispenseVisitType } from "../utils/dispenseVisitType";

interface DispenseVisitTypeBadgeProps {
  visitType?: string | null;
  referenceType?: string | null;
  className?: string;
}

const STYLES: Record<DispenseVisitType, string> = {
  OP: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200 border-sky-200 dark:border-sky-800",
  IP: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 border-amber-200 dark:border-amber-800",
};

export default function DispenseVisitTypeBadge({
  visitType,
  referenceType,
  className = "",
}: DispenseVisitTypeBadgeProps) {
  const label = resolveDispenseVisitType(visitType, referenceType);
  if (!label) return null;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${STYLES[label]} ${className}`}
      title={label === "OP" ? "Outpatient (Patient Visit)" : "Inpatient (Inpatient Admission)"}
    >
      {label}
    </span>
  );
}
