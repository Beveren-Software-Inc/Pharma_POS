import { useEffect, useState } from "react";
import { X, RotateCcw, Package, Minus, Plus } from "lucide-react";
import { toast } from "react-toastify";
import { formatCurrency } from "../utils/currency";
import type { SalesInvoice } from "../../types";
import { createDispenseReturn } from "../services/salesOrder";

interface DispenseReturnLine {
  line_key: string;
  item_code: string;
  item_name: string;
  so_detail?: string;
  dn_detail?: string;
  qty: number;
  rate: number;
  returned_qty: number;
  available_qty: number;
  return_qty: number;
}

function getDispenseLineKey(item: {
  so_detail?: string;
  dn_detail?: string;
  item_code?: string;
  id?: string;
}) {
  return item.dn_detail || item.so_detail || item.item_code || item.id || "";
}

interface DispenseOrderReturnProps {
  order: SalesInvoice | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (returnDeliveryNote: string) => void;
}

export default function DispenseOrderReturn({
  order,
  isOpen,
  onClose,
  onSuccess,
}: DispenseOrderReturnProps) {
  const [returnItems, setReturnItems] = useState<DispenseReturnLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !order) return;

    const items: DispenseReturnLine[] = (order.items || [])
      .map((item) => {
        const qty = Number(item.qty ?? item.quantity ?? 0);
        const returnedQty = Number(item.returned_qty ?? 0);
        const availableQty = Number(
          item.available_qty ?? Math.max(0, qty - returnedQty)
        );
        return {
          line_key: getDispenseLineKey(item),
          item_code: item.item_code || item.id,
          item_name: item.item_name || item.name,
          so_detail: item.so_detail,
          dn_detail: item.dn_detail,
          qty,
          rate: Number(item.rate ?? item.unitPrice ?? 0),
          returned_qty: returnedQty,
          available_qty: availableQty,
          return_qty: availableQty,
        };
      })
      .filter((item) => item.available_qty > 0);

    setReturnItems(items);
  }, [isOpen, order]);

  const handleReturnQtyChange = (lineKey: string, newQty: number) => {
    setReturnItems((prev) =>
      prev.map((item) => {
        if (item.line_key !== lineKey) return item;
        const validQty = Math.max(
          0,
          Math.min(Math.round(newQty * 1000) / 1000, item.available_qty)
        );
        return { ...item, return_qty: validQty };
      })
    );
  };

  const handleReturnAllItems = () => {
    setReturnItems((prev) =>
      prev.map((item) => ({ ...item, return_qty: item.available_qty }))
    );
  };

  const handleClearAll = () => {
    setReturnItems((prev) => prev.map((item) => ({ ...item, return_qty: 0 })));
  };

  const handleSubmitReturn = async () => {
    if (!order) return;

    const itemsToReturn = returnItems
      .filter((item) => item.return_qty > 0)
      .map((item) => ({
        item_code: item.item_code,
        so_detail: item.so_detail,
        dn_detail: item.dn_detail,
        return_qty: item.return_qty,
      }));
    if (itemsToReturn.length === 0) {
      toast.error("Please select at least one item to return");
      return;
    }

    setIsLoading(true);
    try {
      const result = await createDispenseReturn(order.id || order.name, itemsToReturn);
      toast.success(`Return created: ${result.return_delivery_note}`);
      onSuccess(result.return_delivery_note);
      onClose();
    } catch (error) {
      console.error("Error creating dispense return:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create return");
    } finally {
      setIsLoading(false);
    }
  };

  const totalReturnAmount = returnItems.reduce(
    (sum, item) => sum + item.return_qty * item.rate,
    0
  );
  const hasItemsToReturn = returnItems.some((item) => item.return_qty > 0);

  if (!isOpen || !order) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <RotateCcw size={18} className="text-orange-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Return Dispensed Medicine
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {order.id} · {order.customer}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800/40 text-sm text-amber-800 dark:text-amber-200">
          Stock will be returned via a Delivery Note return against{" "}
          {order.deliveryNoteName || "the linked delivery note"}.
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {returnItems.length === 0 ? (
            <div className="text-center py-10 text-gray-500 dark:text-gray-400">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No returnable items remaining on this order.</p>
            </div>
          ) : (
            <>
              <div className="flex justify-end gap-2 mb-4">
                <button
                  type="button"
                  onClick={handleReturnAllItems}
                  className="text-xs px-3 py-1.5 rounded-md bg-orange-50 text-orange-700 hover:bg-orange-100"
                >
                  Return all
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-xs px-3 py-1.5 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
                >
                  Clear
                </button>
              </div>

              <div className="space-y-3">
                {returnItems.map((item) => (
                  <div
                    key={item.line_key}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 dark:text-white truncate">
                        {item.item_name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {item.item_code} · Dispensed {item.qty} · Returned {item.returned_qty}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleReturnQtyChange(item.line_key, item.return_qty - 1)
                        }
                        className="w-8 h-8 rounded-md border border-gray-200 dark:border-gray-600 flex items-center justify-center"
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={item.available_qty}
                        step="any"
                        value={item.return_qty}
                        onChange={(e) =>
                          handleReturnQtyChange(
                            item.line_key,
                            Number(e.target.value) || 0
                          )
                        }
                        className="w-16 h-8 text-center text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleReturnQtyChange(item.line_key, item.return_qty + 1)
                        }
                        className="w-8 h-8 rounded-md border border-gray-200 dark:border-gray-600 flex items-center justify-center"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Return total:{" "}
            <span className="font-semibold text-gray-900 dark:text-white">
              {formatCurrency(totalReturnAmount, order.currency)}
            </span>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmitReturn}
              disabled={isLoading || !hasItemsToReturn}
              className="px-4 py-2 text-sm rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Processing..." : "Submit Return"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
