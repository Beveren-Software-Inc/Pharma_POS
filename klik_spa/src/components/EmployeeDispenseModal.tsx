"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, User, X } from "lucide-react";
import { toast } from "react-toastify";
import type { CartItem } from "../../types";
import { searchEmployees, createEmployeeDispenseInvoice, type EmployeeOption } from "../services/employeeBilling";
import { extractErrorFromException } from "../utils/errorExtraction";
import { usePOSDetails } from "../hooks/usePOSProfile";

interface EmployeeDispenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  itemDiscounts?: Record<string, { batchNumber?: string; serialNumber?: string; dispensingLot?: string }>;
  patientId?: string | null;
  onSuccess?: () => void;
}

export default function EmployeeDispenseModal({
  isOpen,
  onClose,
  cartItems,
  itemDiscounts = {},
  patientId,
  onSuccess,
}: EmployeeDispenseModalProps) {
  const { posDetails } = usePOSDetails();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeOption[]>([]);
  const [selected, setSelected] = useState<EmployeeOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setSelected(null);
      return;
    }
    const run = async () => {
      setSearching(true);
      try {
        setResults(await searchEmployees(query.trim()));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    };
    const id = window.setTimeout(run, query.trim() ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [isOpen, query]);

  if (!isOpen) return null;

  const getLineKey = (item: CartItem) => (item as CartItem & { cartLineId?: string }).cartLineId || item.id;

  const handleSubmit = async () => {
    if (!selected) {
      toast.error("Please select an employee");
      return;
    }
    if (!cartItems.length) {
      toast.error("Cart is empty");
      return;
    }

    setLoading(true);
    try {
      const items = cartItems.map((item) => {
        const lineKey = getLineKey(item);
        const discount = itemDiscounts[lineKey] || itemDiscounts[item.id] || {};
        return {
          item_code: item.item_code || item.id,
          item_name: item.name,
          qty: item.quantity,
          rate: item.price,
          uom: item.uom,
          batch_no: (item as { batch_no?: string }).batch_no || discount.batchNumber,
          serial_no: (item as { serial_no?: string }).serial_no || discount.serialNumber,
        };
      });

      const result = await createEmployeeDispenseInvoice({
        employee: selected.name,
        items,
        company: posDetails?.company,
        cost_center: posDetails?.cost_center,
        patient: patientId || undefined,
      });

      toast.success(`Employee dispense created: ${result.name}`);
      onSuccess?.();
      onClose();
    } catch (error) {
      toast.error(extractErrorFromException(error, "Failed to dispense to employee"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <User size={18} className="text-beveren-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Dispense to Employee</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Dispense {cartItems.length} cart item(s) as internal employee billing.
          </p>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              value={selected ? selected.employee_name || selected.name : query}
              onChange={(e) => {
                setSelected(null);
                setQuery(e.target.value);
              }}
              placeholder="Search employee..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          {!selected && (
            <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              {searching ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  <Loader2 size={16} className="animate-spin inline mr-2" />
                  Searching...
                </div>
              ) : results.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">No employees found</div>
              ) : (
                results.map((emp) => (
                  <button
                    key={emp.name}
                    type="button"
                    onClick={() => setSelected(emp)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                  >
                    <div className="font-medium text-sm text-gray-900 dark:text-white">
                      {emp.employee_name || emp.name}
                    </div>
                    <div className="text-xs text-gray-500">{emp.department || emp.designation || emp.name}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !selected}
            className="px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Dispense
          </button>
        </div>
      </div>
    </div>
  );
}
