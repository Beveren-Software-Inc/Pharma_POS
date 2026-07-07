"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import {
  getPharmacyServiceItems,
  type PharmacyServiceItem,
} from "../services/pharmacyService";

interface PharmacyServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentItemName?: string;
  currencySymbol?: string;
  onSelectService: (service: PharmacyServiceItem) => void;
}

export default function PharmacyServiceModal({
  isOpen,
  onClose,
  parentItemName,
  currencySymbol = "",
  onSelectService,
}: PharmacyServiceModalProps) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<PharmacyServiceItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setItems([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const results = await getPharmacyServiceItems(search);
      if (!cancelled) {
        setItems(results);
        setLoading(false);
      }
    };

    const timer = setTimeout(load, search ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 lg:left-20 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 bg-beveren-500 text-white rounded-t-lg shrink-0">
          <div>
            <h3 className="text-lg font-semibold">Add Service</h3>
            {parentItemName && (
              <p className="text-sm text-beveren-100 mt-0.5 truncate">
                For: {parentItemName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-beveren-400/80 text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search services..."
              className="w-full pl-10 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-beveren-500 focus:border-transparent"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
              Loading services...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
              No pharmacy service items found.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectService(item)}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-beveren-50 dark:hover:bg-beveren-900/20 hover:border-beveren-300 dark:hover:border-beveren-700 transition-colors text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white truncate">
                      {item.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {item.id}
                      {item.uom ? ` · ${item.uom}` : ""}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-beveren-600 dark:text-beveren-400 shrink-0">
                    {(item.price || 0) > 0 ? (
                      <>
                        {currencySymbol}
                        {item.price.toFixed(3)}
                      </>
                    ) : (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        Enter amount in cart
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
