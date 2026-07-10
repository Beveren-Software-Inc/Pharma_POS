export type DispenseVisitType = "OP" | "IP";

export function visitTypeFromReference(referenceType?: string | null): DispenseVisitType | null {
  const value = referenceType?.trim().toLowerCase() || "";
  if (!value) return null;
  if (value.includes("patient visit")) return "OP";
  if (value.includes("inpatient")) return "IP";
  return null;
}

export function resolveDispenseVisitType(
  visitType?: string | null,
  referenceType?: string | null
): DispenseVisitType | null {
  const normalized = visitType?.trim().toUpperCase();
  if (normalized === "OP" || normalized === "IP") return normalized;
  return visitTypeFromReference(referenceType);
}
