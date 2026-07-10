"use client";

import { useEffect, useState } from "react";
import {
  clearBatchListCache,
  formatBatchExpiryLabel,
  getBatchesCached,
  type BatchStockOption,
} from "../utils/batch";

interface PharmacyItemDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemName: string;
  itemCode?: string;
  hasBatchNo?: boolean;
  custom_strength?: string | null;
  custom_pharmaceutical_form?: string | null;
  custom_number_of_pack?: number | null;
  custom_pack_size?: string | null;
  custom_route_of_administration?: string | null;
  position?: "right" | "center";
}

export default function PharmacyItemDetailsModal({
  isOpen,
  onClose,
  itemName,
  itemCode,
  hasBatchNo = false,
  custom_strength,
  custom_pharmaceutical_form,
  custom_number_of_pack,
  custom_pack_size,
  custom_route_of_administration,
  position = "center",
}: PharmacyItemDetailsModalProps) {
  const [batches, setBatches] = useState<BatchStockOption[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).lastMouseX = e.clientX;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).lastMouseY = e.clientY;
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const handleBatchRefresh = () => clearBatchListCache();
    window.addEventListener("batchQuantitiesUpdated", handleBatchRefresh);
    return () => window.removeEventListener("batchQuantitiesUpdated", handleBatchRefresh);
  }, []);

  const hasPharmacyData =
    custom_strength ||
    custom_pharmaceutical_form ||
    custom_number_of_pack !== null ||
    custom_number_of_pack !== undefined ||
    custom_pack_size ||
    custom_route_of_administration;

  const shouldShow = isOpen && (hasPharmacyData || hasBatchNo);

  useEffect(() => {
    if (!shouldShow || !hasBatchNo || !itemCode?.trim()) {
      setBatches([]);
      setBatchError(null);
      setLoadingBatches(false);
      return;
    }

    let cancelled = false;
    setLoadingBatches(true);
    setBatchError(null);

    void getBatchesCached(itemCode.trim())
      .then((rows) => {
        if (cancelled) return;
        setBatches(rows);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load item batches:", error);
        setBatches([]);
        setBatchError("Unable to load batches");
      })
      .finally(() => {
        if (!cancelled) setLoadingBatches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldShow, hasBatchNo, itemCode]);

  if (!shouldShow) return null;

  const positionClasses =
    position === "right"
      ? "fixed left-[calc(65%-8px)] top-24 z-40"
      : "fixed left-1/2 top-24 z-40 -translate-x-1/2";

  const panelTitle = hasPharmacyData
    ? hasBatchNo
      ? "Item Details"
      : "Pharmacy Details"
    : "Batch Stock";

  return (
    <div
      className={`${positionClasses} pharmacy-tooltip bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-80 max-h-[60vh] overflow-y-auto pointer-events-auto`}
      onMouseEnter={(e) => {
        e.stopPropagation();
      }}
      onMouseLeave={() => {
        setTimeout(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mouseX = (window as any).lastMouseX || 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mouseY = (window as any).lastMouseY || 0;
          const hoveredElement = document.elementFromPoint(mouseX, mouseY);
          const isOverProduct = hoveredElement?.closest("[data-item-hover-target]");

          if (!isOverProduct) {
            onClose();
          }
        }, 200);
      }}
    >
      <div className="p-4">
        <div className="mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{panelTitle}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate">{itemName}</p>
          {itemCode && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 font-mono truncate">
              {itemCode}
            </p>
          )}
        </div>

        {hasPharmacyData && (
          <div className="space-y-2">
            {custom_strength && (
              <div className="flex justify-between items-start py-1">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Strength:</span>
                <span className="text-xs text-gray-900 dark:text-white text-right flex-1 ml-2">
                  {custom_strength}
                </span>
              </div>
            )}

            {custom_pharmaceutical_form && (
              <div className="flex justify-between items-start py-1">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Form:</span>
                <span className="text-xs text-gray-900 dark:text-white text-right flex-1 ml-2">
                  {custom_pharmaceutical_form}
                </span>
              </div>
            )}

            {custom_number_of_pack !== null && custom_number_of_pack !== undefined && (
              <div className="flex justify-between items-start py-1">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Packs:</span>
                <span className="text-xs text-gray-900 dark:text-white text-right flex-1 ml-2">
                  {custom_number_of_pack}
                </span>
              </div>
            )}

            {custom_pack_size && (
              <div className="flex justify-between items-start py-1">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Pack Size:</span>
                <span className="text-xs text-gray-900 dark:text-white text-right flex-1 ml-2">
                  {custom_pack_size}
                </span>
              </div>
            )}

            {custom_route_of_administration && (
              <div className="flex justify-between items-start py-1">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Route:</span>
                <span className="text-xs text-gray-900 dark:text-white text-right flex-1 ml-2">
                  {custom_route_of_administration}
                </span>
              </div>
            )}
          </div>
        )}

        {hasBatchNo && (
          <div className={hasPharmacyData ? "mt-3 pt-3 border-t border-gray-200 dark:border-gray-700" : ""}>
            <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2 uppercase tracking-wide">
              Batches
            </h4>
            {loadingBatches ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">Loading batches...</p>
            ) : batchError ? (
              <p className="text-xs text-red-500 dark:text-red-400">{batchError}</p>
            ) : batches.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">No batches in stock</p>
            ) : (
              <div className="space-y-1.5">
                {batches.map((batch) => (
                  <div
                    key={batch.batch_id}
                    className="flex items-start justify-between gap-3 text-xs py-1 border-b border-gray-100 dark:border-gray-700/80 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 dark:text-white truncate">
                        {batch.batch_id}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">Qty: {batch.qty}</div>
                    </div>
                    <div className="text-right flex-shrink-0 text-gray-600 dark:text-gray-300">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        Exp
                      </div>
                      <div>{formatBatchExpiryLabel(batch.expiry_date) || "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
