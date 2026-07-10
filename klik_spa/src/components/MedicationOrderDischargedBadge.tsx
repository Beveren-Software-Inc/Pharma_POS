import { Check } from "lucide-react";

interface MedicationOrderDischargedBadgeProps {
  afterDischarge?: boolean | number | string | null;
  className?: string;
}

function isAfterDischarge(value: MedicationOrderDischargedBadgeProps["afterDischarge"]): boolean {
  return value === true || value === 1 || value === "1";
}

export default function MedicationOrderDischargedBadge({
  afterDischarge,
  className = "",
}: MedicationOrderDischargedBadgeProps) {
  if (!isAfterDischarge(afterDischarge)) return null;

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200 border-violet-200 dark:border-violet-800 ${className}`}
      title="After Discharge prescription"
    >
      <Check size={10} strokeWidth={3} />
      Discharged
    </span>
  );
}
