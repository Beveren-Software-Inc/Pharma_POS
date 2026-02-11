"use client";

import { X } from "lucide-react";
import type { CartItem } from "../../types";

interface AdditionalAmountModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onItemAdditionalChange: (id: string, amount: number) => void;
  generalAmount: number;
  onGeneralAmountChange: (amount: number) => void;
  remark: string | null;
  onRemarkChange: (remark: string) => void;
  currencySymbol?: string;
}

export default function AdditionalAmountModal({
  isOpen,
  onClose,
  cartItems,
  onItemAdditionalChange,
  generalAmount,
  onGeneralAmountChange,
  remark,
  onRemarkChange,
  currencySymbol = "",
}: AdditionalAmountModalProps) {
  if (!isOpen) return null;

  const handleItemChange = (id: string, value: string) => {
    const amount = parseFloat(value) || 0;
    onItemAdditionalChange(id, Math.max(0, amount));
  };

  const handleGeneralChange = (value: string) => {
    const amount = parseFloat(value) || 0;
    onGeneralAmountChange(Math.max(0, amount));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header: primary (beveren) slightly lighter than Apply button */}
        <div className="flex items-center justify-between px-6 py-4 bg-beveren-500 text-white rounded-t-lg shrink-0">
          <h3 className="text-lg font-semibold">
            Additional Amounts
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-beveren-400/80 text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Add per-item and general additional charges (e.g. syringes, misc services).
        </p>

        {/* Per-item additional amounts */}
        {cartItems.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
              Item additional amounts
            </div>
            {cartItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 text-sm border border-gray-100 dark:border-gray-700 rounded-md px-2 py-1.5 bg-gray-50 dark:bg-gray-800/60"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium text-gray-900 dark:text-white">
                    {item.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Qty: {item.quantity}
                  </div>
                </div>
                <div className="w-28">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      ((item as { additional_amount?: number }).additional_amount ??
                        "") as number | string
                    }
                    onChange={(e) => handleItemChange(item.id, e.target.value)}
                    placeholder="0.00"
                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* General additional amount */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            General additional amount
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={generalAmount || ""}
            onChange={(e) => handleGeneralChange(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
          />
          {currencySymbol && (
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">
              {currencySymbol}
            </span>
          )}
        </div>

        {/* Remark */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Remark (will appear on invoice)
          </label>
          <textarea
            rows={3}
            value={remark || ""}
            onChange={(e) => onRemarkChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
            placeholder="e.g. Syringe provided externally"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 text-sm"
          >
            Apply
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
