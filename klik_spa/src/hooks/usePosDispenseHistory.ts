import { useEffect, useState, useCallback } from "react";
import type { SalesInvoice, SalesInvoiceItem } from "../../types";

const DISPENSE_STATUS = "Dispensed medicine" as const;

export function usePosDispenseHistory(
  searchTerm: string = "",
  cashierName?: string,
  enabled = true
) {
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const LIMIT = 100;
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchDispenses = useCallback(
    async (page = 0, append = false) => {
      if (!enabled) return;

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const start = page * LIMIT;
        const searchParam = debouncedSearchTerm
          ? `&search=${encodeURIComponent(debouncedSearchTerm)}`
          : "";
        const cashierParam =
          cashierName && cashierName !== "all"
            ? `&cashier_name=${encodeURIComponent(cashierName)}`
            : "";

        const response = await fetch(
          `/api/method/klik_pos.api.sales_order.get_pos_dispense_history?limit=${LIMIT}&start=${start}${searchParam}${cashierParam}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            credentials: "include",
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resData = await response.json();
        if (!resData.message || !resData.message.success) {
          throw new Error(
            resData.message?.error || resData.error || "Failed to fetch dispense history"
          );
        }

        const rawRows = resData.message.data;
        const newCount = rawRows.length;
        const totalCountFromAPI = resData.message.total_count || 0;

        setHasMore(newCount === LIMIT);
        setTotalCount(totalCountFromAPI);

        const transformed: SalesInvoice[] = rawRows.map(
          (row: Record<string, unknown>) => {
            const items: SalesInvoiceItem[] = Array.isArray(row.items)
              ? (row.items as Array<Record<string, unknown>>).map((item) => ({
                  id: String(item.item_code || ""),
                  name: String(item.item_name || item.item_code || ""),
                  category: "",
                  quantity: Number(item.qty) || 0,
                  unitPrice: Number(item.rate) || 0,
                  total: Number(item.amount) || 0,
                  discount: 0,
                  item_code: String(item.item_code || ""),
                  item_name: String(item.item_name || ""),
                  qty: Number(item.qty) || 0,
                  rate: Number(item.rate) || 0,
                  amount: Number(item.amount) || 0,
                  returned_qty: Number(item.returned_qty) || 0,
                  available_qty: Number(item.available_qty ?? item.qty) || 0,
                  so_detail: item.so_detail ? String(item.so_detail) : undefined,
                  dn_detail: item.dn_detail ? String(item.dn_detail) : undefined,
                  batch_no: item.batch_no ? String(item.batch_no) : undefined,
                  return_status: item.return_status as SalesInvoiceItem["return_status"],
                }))
              : [];

            const apiStatus = row.status ? String(row.status) : DISPENSE_STATUS;

            return {
              id: String(row.name),
              name: String(row.name),
              date: String(row.posting_date || new Date().toISOString().split("T")[0]),
              time: String(row.posting_time || "00:00:00"),
              cashier: String(row.cashier_name || row.owner || ""),
              cashierId: String(row.owner || ""),
              customer: String(row.customer_name || row.customer || ""),
              customerId: String(row.customer || ""),
              items,
              subtotal: Number(row.base_grand_total) || 0,
              giftCardDiscount: 0,
              giftCardCode: "",
              taxAmount: 0,
              totalAmount: Number(row.base_grand_total) || 0,
              paymentMethod: "Dispensed medicine",
              payment_methods: [],
              amountPaid: 0,
              changeGiven: 0,
              status: apiStatus,
              refundAmount: 0,
              notes: row.custom_remarks ? String(row.custom_remarks) : "",
              currency: String(row.currency || "USD"),
              posProfile: "",
              custom_pos_opening_entry: "",
              canReturn: Boolean(row.can_return),
              isPosDispense: true,
              isHeldDispense: Boolean(row.is_held_dispense),
              deliveryNoteName: row.delivery_note_name
                ? String(row.delivery_note_name)
                : undefined,
              returnedLineCount: Number(row.returned_line_count) || 0,
            } as SalesInvoice;
          }
        );

        if (append) {
          setInvoices((prev) => [...prev, ...transformed]);
          setTotalLoaded((prev) => prev + newCount);
        } else {
          setInvoices(transformed);
          setTotalLoaded(newCount);
        }

        setCurrentPage(page);
        setError(null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        setError(err.message || "Unknown error occurred");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [debouncedSearchTerm, cashierName, enabled]
  );

  const loadMore = useCallback(() => {
    if (!enabled) return;
    if (!isLoadingMore && hasMore) {
      fetchDispenses(currentPage + 1, true);
    }
  }, [currentPage, isLoadingMore, hasMore, fetchDispenses, enabled]);

  const refetch = useCallback(() => {
    if (!enabled) return;
    setCurrentPage(0);
    setTotalLoaded(0);
    setHasMore(true);
    fetchDispenses(0, false);
  }, [fetchDispenses, enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    setCurrentPage(0);
    setTotalLoaded(0);
    setHasMore(true);
    fetchDispenses(0, false);
  }, [debouncedSearchTerm, cashierName, enabled, fetchDispenses]);

  return {
    invoices,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    totalLoaded,
    totalCount,
    loadMore,
    refetch,
  };
}
