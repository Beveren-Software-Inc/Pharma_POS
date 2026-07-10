import { getItemUOMsAndPrices } from "../services/uomService";

const UNIT_UOM_KEY = "UNIT";
const unitUomAvailabilityCache = new Map<string, boolean>();

function normalizeUom(value?: string | null): string {
  return (value || "").trim().toUpperCase();
}

function findUnitUomName(uoms: Array<{ uom?: string }>): string | null {
  const match = uoms.find((row) => normalizeUom(row.uom) === UNIT_UOM_KEY);
  return match?.uom?.trim() || null;
}

export function itemMayUseUnitUom(item: { uom?: string; stock_uom?: string }): boolean {
  return (
    normalizeUom(item.uom) === UNIT_UOM_KEY ||
    normalizeUom(item.stock_uom) === UNIT_UOM_KEY
  );
}

export async function itemHasUnitUom(itemCode: string): Promise<boolean> {
  const code = (itemCode || "").trim();
  if (!code) return false;

  if (unitUomAvailabilityCache.has(code)) {
    return unitUomAvailabilityCache.get(code) === true;
  }

  try {
    const { uoms } = await getItemUOMsAndPrices(code);
    const hasUnit = !!findUnitUomName(uoms);
    unitUomAvailabilityCache.set(code, hasUnit);
    return hasUnit;
  } catch {
    return false;
  }
}

/** Hospital pharmacy: prefer UNIT when the item supports it. */
export async function resolveHospitalCartUom(
  itemCode: string,
  fallbackUom?: string
): Promise<string> {
  const fallback = (fallbackUom || "").trim();
  try {
    const { uoms } = await getItemUOMsAndPrices(itemCode);
    const unitName = findUnitUomName(uoms);
    const hasUnit = !!unitName;
    unitUomAvailabilityCache.set(itemCode, hasUnit);
    if (unitName) return unitName;
  } catch {
    if (normalizeUom(fallback) === UNIT_UOM_KEY) return fallback;
  }
  return fallback;
}
