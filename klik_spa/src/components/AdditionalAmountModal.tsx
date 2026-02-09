"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface AdditionalAmountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amount: number) => void;
  currencySymbol?: string;
  currentAmount?: number;
}

export default function AdditionalAmountModal({
  isOpen,
  onClose,
  onConfirm,
  currencySymbol = "",
  currentAmount = 0,
}: AdditionalAmountModalProps) {
  const [inputValue, setInputValue] = useState(
    currentAmount > 0 ? String(currentAmount) : ""
  );

  const handleConfirm = () => {
    const amount = parseFloat(inputValue) || 0;
    onConfirm(Math.max(0, amount));
    setInputValue("");
    onClose();
  };

  const handleClose = () => {
    setInputValue(currentAmount > 0 ? String(currentAmount) : "");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Additional Amount
          </h3>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Add a miscellaneous charge (e.g. syringe, delivery fee)
        </p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Amount
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`0.00`}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            autoFocus
          />
          {currencySymbol && (
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">
              {currencySymbol}
            </span>
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
