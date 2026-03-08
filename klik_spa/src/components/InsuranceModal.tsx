"use client";

import { useState, useEffect } from "react";
import { X, Loader2, ChevronDown } from "lucide-react";

export interface HealthInsuranceOption {
  name: string;
  insurance_company?: string;
  insurance_coverage_?: number;
  mode_of_payment?: string | null;
}

interface InsuranceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (insurance: HealthInsuranceOption | null) => void;
  selectedInsurance: HealthInsuranceOption | null;
}

export default function InsuranceModal({
  isOpen,
  onClose,
  onSelect,
  selectedInsurance,
}: InsuranceModalProps) {
  const [list, setList] = useState<HealthInsuranceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selected, setSelected] = useState<HealthInsuranceOption | null>(selectedInsurance);

  useEffect(() => {
    if (isOpen) {
      setSelected(selectedInsurance);
      setError(null);
      setLoading(true);
      fetch("/api/method/klik_pos.api.health_insurance.get_health_insurance_list", {
        credentials: "include",
      })
        .then((res) => res.json())
        .then((data) => {
          const msg = data?.message;
          if (msg?.success && Array.isArray(msg?.data)) {
            setList(msg.data);
          } else {
            setError(msg?.message || "Failed to load Health Insurance list.");
          }
        })
        .catch(() => setError("Failed to load Health Insurance list."))
        .finally(() => setLoading(false));
    }
  }, [isOpen, selectedInsurance]);

  const handleConfirm = () => {
    if (selected) {
      onSelect(selected);
      onClose();
    }
  };

  const handleClear = () => {
    setSelected(null);
    onSelect(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Select Insurance
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          >
            <X size={20} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin text-beveren-600" />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
        )}

        {!loading && !error && (
          <>
            <div className="relative mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Health Insurance
              </label>
              <button
                type="button"
                onClick={() => setIsDropdownOpen((o) => !o)}
                onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-left text-gray-900 dark:text-white flex items-center justify-between"
              >
                <span className="truncate">
                  {selected
                    ? `${selected.name}${selected.insurance_company ? ` (${selected.insurance_company})` : ""}`
                    : "Select Health Insurance"}
                </span>
                <ChevronDown size={16} className="flex-shrink-0 ml-2" />
              </button>
              {isDropdownOpen && (
                <ul className="absolute z-10 mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 shadow-lg max-h-48 overflow-y-auto">
                  {list.map((item) => (
                    <li key={item.name}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-white hover:bg-beveren-50 dark:hover:bg-beveren-900/20"
                        onClick={() => {
                          setSelected(item);
                          setIsDropdownOpen(false);
                        }}
                      >
                        {item.name}
                        {item.insurance_company ? ` (${item.insurance_company})` : ""}
                        {item.insurance_coverage_ != null
                          ? ` — ${item.insurance_coverage_}% coverage`
                          : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selected && (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                <p>
                  <span className="text-gray-600 dark:text-gray-400">Coverage: </span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {selected.insurance_coverage_ ?? 0}%
                  </span>
                </p>
                {selected.mode_of_payment && (
                  <p>
                    <span className="text-gray-600 dark:text-gray-400">Mode of payment: </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {selected.mode_of_payment}
                    </span>
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selected}
                className="px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
