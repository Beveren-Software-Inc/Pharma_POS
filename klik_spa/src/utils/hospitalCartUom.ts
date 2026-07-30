import { getItemUOMsAndPrices } from "../services/uomService";

const UNIT_UOM_KEY = "UNIT";
const PACK_UOM_KEY = "PACK";
const unitUomAvailabilityCache = new Map<string, boolean>();

export function normalizeUom(value?: string | null): string {
  return (value || "").trim().toUpperCase();
}

function findUnitUomName(uoms: Array<{ uom?: string }>): string | null {
  const match = uoms.find((row) => normalizeUom(row.uom) === UNIT_UOM_KEY);
  return match?.uom?.trim() || null;
}

/**
 * Medication-order UOM for cart/stock:
 * - PACK stays PACK
 * - UNIT stays UNIT
 * - anything else (Milligram, Tablet, etc.) is treated as UNIT
 */
export function resolveMedicationOrderUom(orderUom?: string | null): "UNIT" | "PACK" {
  const key = normalizeUom(orderUom);
  if (key === PACK_UOM_KEY) return "PACK";
  return "UNIT";
}

/** ERPNext: conversion_factor = stock_uom qty per 1 of this UOM. */
export function getUomConversionFactor(
  uoms: Array<{ uom?: string; conversion_factor?: number }>,
  baseUom: string,
  uom?: string | null
): number {
  const target = (uom || "").trim();
  if (!target || normalizeUom(target) === normalizeUom(baseUom)) return 1;
  const match = uoms.find((row) => normalizeUom(row.uom) === normalizeUom(target));
  const cf = Number(match?.conversion_factor);
  return Number.isFinite(cf) && cf > 0 ? cf : 1;
}

export function itemSupportsUom(
  uoms: Array<{ uom?: string }>,
  baseUom: string,
  uom?: string | null
): boolean {
  const target = (uom || "").trim();
  if (!target) return false;
  if (normalizeUom(target) === normalizeUom(baseUom)) return true;
  return uoms.some((row) => normalizeUom(row.uom) === normalizeUom(target));
}

/**
 * Convert a prescribed qty on one item into cart qty on another (e.g. alternative drug).
 * Preserves stock quantity: order → original stock UOM → alternative cart UOM.
 */
export async function convertPrescribedQtyViaStockUom(args: {
  prescribedItemCode: string;
  dispenseItemCode: string;
  orderQuantity: number;
  orderUom?: string;
  cartUom: string;
}): Promise<{ cartQuantity: number; cartConversionFactor: number; stockUom: string }> {
  const orderQty = Number(args.orderQuantity) || 0;
  const [prescribed, dispense] = await Promise.all([
    getItemUOMsAndPrices(args.prescribedItemCode),
    getItemUOMsAndPrices(args.dispenseItemCode),
  ]);

  const orderCf = getUomConversionFactor(
    prescribed.uoms,
    prescribed.base_uom,
    args.orderUom || prescribed.base_uom
  );
  const cartCf = getUomConversionFactor(dispense.uoms, dispense.base_uom, args.cartUom);
  const stockQty = orderQty * orderCf;
  const cartQuantity = cartCf > 0 ? stockQty / cartCf : stockQty;

  return {
    cartQuantity,
    cartConversionFactor: cartCf,
    stockUom: dispense.base_uom,
  };
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

export type CartUomResolution = {
  uom: string;
  conversion_factor: number;
  stock_uom: string;
};

/** Hospital pharmacy: prefer UNIT when the item supports it. */
export async function resolveHospitalCartUom(
  itemCode: string,
  fallbackUom?: string
): Promise<string> {
  const resolved = await resolveHospitalCartUomDetails(itemCode, fallbackUom);
  return resolved.uom;
}

/**
 * Resolve cart UOM plus ERPNext conversion_factor (stock qty per 1 cart UOM).
 * product.available is always in stock_uom; cart max qty = available / conversion_factor.
 */
export async function resolveHospitalCartUomDetails(
  itemCode: string,
  fallbackUom?: string
): Promise<CartUomResolution> {
  const fallback = (fallbackUom || "").trim();
  try {
    const { uoms, base_uom } = await getItemUOMsAndPrices(itemCode);
    const unitName = findUnitUomName(uoms);
    unitUomAvailabilityCache.set(itemCode, !!unitName);
    const uom = (unitName || fallback || base_uom || "").trim();
    return {
      uom,
      conversion_factor: getUomConversionFactor(uoms, base_uom, uom),
      stock_uom: base_uom || fallback || uom,
    };
  } catch {
    const uom =
      normalizeUom(fallback) === UNIT_UOM_KEY ? fallback : fallback;
    return { uom, conversion_factor: 1, stock_uom: uom };
  }
}

/** Resolve any requested cart UOM (pharmacy default / hospital) with conversion. */
export async function resolveCartUomDetails(
  itemCode: string,
  preferredUom?: string
): Promise<CartUomResolution> {
  const preferred = (preferredUom || "").trim();
  try {
    const { uoms, base_uom } = await getItemUOMsAndPrices(itemCode);
    const uom = preferred || base_uom;
    return {
      uom,
      conversion_factor: getUomConversionFactor(uoms, base_uom, uom),
      stock_uom: base_uom || uom,
    };
  } catch {
    return { uom: preferred, conversion_factor: 1, stock_uom: preferred };
  }
}
