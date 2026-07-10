import { useState, useMemo, useEffect, useLayoutEffect, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FilePlus,
  RefreshCw,
  Download,
  Search,
  DollarSign,
  Grid3X3,
  List,
  Eye,
  Edit,
  Users,
  ShoppingCart,
  RotateCcw,
  Check,
  FileMinus,
  ChevronDown,
  ChevronRight,
  Printer,
} from "lucide-react";

import InvoiceViewModal from "../components/InvoiceViewModal";
import BottomNavigation from "../components/BottomNavigation";
import MultiInvoiceReturn from "../components/MultiInvoiceReturn";
import SingleInvoiceReturn from "../components/SingleInvoiceReturn";
import DispenseOrderReturn from "../components/DispenseOrderReturn";
import DispenseVisitTypeBadge from "../components/DispenseVisitTypeBadge";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { formatCurrency } from "../utils/currency";
import type { SalesInvoice } from "../../types";
import { useSalesInvoices } from "../hooks/useSalesInvoices";
import { usePosDispenseHistory } from "../hooks/usePosDispenseHistory";
import { useCustomers } from "../hooks/useCustomers";
import { useUserInfo } from "../hooks/useUserInfo";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { getPartyLabels } from "../utils/partyLabels";
import { toast } from "react-toastify";
import { extractErrorFromException } from "../utils/errorExtraction";
import { createSalesReturn, deleteDraftInvoice, submitDraftInvoice } from "../services/salesInvoice";
import { deleteDraftHospitalSalesOrder } from "../services/salesOrder";
import { useAllPaymentModes } from "../hooks/usePaymentModes";

import { addDraftInvoiceToCart } from "../utils/draftInvoiceToCart";
import { addHeldDispenseOrderToCart } from "../utils/heldDispenseOrderToCart";
import {
  clearHeldDispenseOrderCache,
  getOriginalHeldDispenseOrderId,
} from "../utils/heldDispenseOrderCache";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { isToday, isThisWeek, isThisMonth, isThisYear } from "../utils/time";
import { exportInvoicesToCSV, getExportFilename, type ExportableInvoice } from "../utils/exportUtils";
import { getPrintFormatsForDoctype } from "../services/patientService";
import {
  getItemReturnBadgeClass,
  getItemReturnLabel,
  getItemReturnStatus,
  getReturnedLineCount,
} from "../utils/dispenseReturnStatus";
// import InvoiceViewPage from "./InvoiceViewPage";

export default function InvoiceHistoryPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [cashierFilter, setCashierFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"cards" | "list">("list");
  const [selectedInvoice] = useState<SalesInvoice | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // Multi-Invoice Return states
  const [showCustomerSelection, setShowCustomerSelection] = useState(false);
  const [showMultiReturn, setShowMultiReturn] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");


  // Single Invoice Return states
  const [showSingleReturn, setShowSingleReturn] = useState(false);
  const [selectedInvoiceForReturn, setSelectedInvoiceForReturn] = useState<SalesInvoice | null>(null);

  // Hospital dispense return states
  const [showDispenseReturn, setShowDispenseReturn] = useState(false);
  const [selectedDispenseOrder, setSelectedDispenseOrder] = useState<SalesInvoice | null>(null);
  const [expandedDispenseOrders, setExpandedDispenseOrders] = useState<Set<string>>(new Set());
  const [openDispensePrintFor, setOpenDispensePrintFor] = useState<string | null>(null);
  const [dispensePrintMenuPosition, setDispensePrintMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const dispensePrintButtonRef = useRef<HTMLButtonElement | null>(null);
  const [salesOrderPrintFormats, setSalesOrderPrintFormats] = useState<string[]>(["Standard"]);

  // Delete confirmation states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SalesInvoice | null>(null);

  // Original edit options states
  const [showEditOptions, setShowEditOptions] = useState(false);
  const [selectedDraftInvoice, setSelectedDraftInvoice] = useState<SalesInvoice | null>(null);

  // Skip opening entry filter for Invoice History - show all invoices for cashier regardless of opening entry
  const { posDetails } = usePOSDetails();
  const isHospitalPharmacy = posDetails?.custom_is_hospital_pharmacy === 1 ||
    posDetails?.custom_is_hospital_pharmacy === true ||
    posDetails?.custom_is_hospital_pharmacy === "1";
  const party = getPartyLabels(isHospitalPharmacy);

  const salesInvoiceQuery = useSalesInvoices(searchTerm, true, cashierFilter, !isHospitalPharmacy);
  const dispenseQuery = usePosDispenseHistory(searchTerm, cashierFilter, isHospitalPharmacy);
  const {
    invoices,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    totalLoaded,
    totalCount,
    loadMore,
    refetch,
  } = isHospitalPharmacy ? dispenseQuery : salesInvoiceQuery;

  const { modes } = useAllPaymentModes();
  const { customers } = useCustomers();
  const { userInfo, isLoading: userInfoLoading } = useUserInfo();

  // Role-based filtering
  const isAdminUser = userInfo?.is_admin_user || false;
  const currentUserCashier = userInfo?.full_name || "";

  // Set default cashier filter for non-admin users
  useEffect(() => {
    if (!isAdminUser && currentUserCashier && cashierFilter === "all") {
      setCashierFilter(currentUserCashier);
    }
  }, [isAdminUser, currentUserCashier, cashierFilter]);

  // Keyboard event handler for Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showEditOptions) {
          handleCloseEditOptions();
        }
        if (showCustomerSelection) {
          setShowCustomerSelection(false);
        }
        if (showMultiReturn) {
          setShowMultiReturn(false);
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showEditOptions, showCustomerSelection, showMultiReturn]);

  const tabs = isHospitalPharmacy
    ? [{ id: "all", name: "Dispensed Medicine", icon: FileText, color: "text-green-600" }]
    : [
    { id: "all", name: "All Invoices", icon: FileText, color: "text-gray-600" },
    { id: "Draft", name: "Draft", icon: FilePlus, color: "text-gray-500" },
    { id: "Unpaid", name: "Unpaid", icon: Clock, color: "text-yellow-600" },
    { id: "Partly Paid", name: "Partly Paid", icon: AlertTriangle, color: "text-orange-600" },
    { id: "Paid", name: "Paid", icon: CheckCircle, color: "text-green-600" },
    { id: "Overdue", name: "Overdue", icon: XCircle, color: "text-red-600" },
    { id: "Return", name: "Returns", icon: RefreshCw, color: "text-purple-600" },
    { id: "Cancelled", name: "Cancelled", icon: XCircle, color: "text-red-500" },
  ];

  useEffect(() => {
    if (!isHospitalPharmacy) return;
    void getPrintFormatsForDoctype("Sales Order").then((res) => {
      setSalesOrderPrintFormats(res.formats);
    });
  }, [isHospitalPharmacy]);

  useLayoutEffect(() => {
    if (!openDispensePrintFor || !dispensePrintButtonRef.current) return;
    const rect = dispensePrintButtonRef.current.getBoundingClientRect();
    setDispensePrintMenuPosition({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [openDispensePrintFor]);

  useEffect(() => {
    if (!openDispensePrintFor) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dispense-print-menu]") && !target.closest("[data-dispense-print-trigger]")) {
        setOpenDispensePrintFor(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openDispensePrintFor]);

  const toggleDispenseExpand = (orderId: string) => {
    setExpandedDispenseOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const openDispensePrint = (doctype: string, name: string, format = "Standard") => {
    const params = new URLSearchParams({
      doctype,
      name,
      format,
      trigger_print: "1",
      no_letterhead: "0",
    });
    window.open(`${window.location.origin}/printview?${params}`, "_blank", "noopener,noreferrer");
  };

  const canReturnDispenseOrder = (invoice: SalesInvoice) => {
    if (!invoice.canReturn) return false;
    return (invoice.items || []).some((item) => (item.available_qty ?? 0) > 0);
  };

  const filterInvoiceByDate = (invoiceDateStr: string) => {
    if (dateFilter === "all") return true;

    if (dateFilter === "today") {
      return isToday(invoiceDateStr);
    }

    if (dateFilter === "yesterday") {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const invoiceDate = new Date(invoiceDateStr);
      return (
        invoiceDate.getUTCFullYear() === yesterday.getUTCFullYear() &&
        invoiceDate.getUTCMonth() === yesterday.getUTCMonth() &&
        invoiceDate.getUTCDate() === yesterday.getUTCDate()
      );
    }

    if (dateFilter === "week") {
      return isThisWeek(invoiceDateStr);
    }

    if (dateFilter === "month") {
      return isThisMonth(invoiceDateStr);
    }

    if (dateFilter === "year") {
      return isThisYear(invoiceDateStr);
    }

    return true;
  };


const getStatusBadge = (status: string) => {
  const baseClasses = "px-2 py-1 rounded-full text-xs font-medium";
  const normalized = status?.toLowerCase() || "";

  switch (normalized) {
    // Payment statuses
    case "dispensed medicine":
      return `${baseClasses} bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400`;
    case "partially returned":
      return `${baseClasses} bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400`;
    case "fully returned":
      return `${baseClasses} bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400`;
    case "paid":
      return `${baseClasses} bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400`;
    case "unpaid":
      return `${baseClasses} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400`;
    case "partly paid":
      return `${baseClasses} bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400`;
    case "overdue":
      return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400`;
    case "draft":
      return `${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400`;
    case "held":
      return `${baseClasses} bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400`;
    case "return":
      return `${baseClasses} bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400`;
    case "cancelled":
      return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400`;

    // ZATCA submission statuses
    case "pending":
      return `${baseClasses} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400`;
    case "reported":
      return `${baseClasses} bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400`;
    case "not reported":
      return `${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400`;
    case "cleared":
      return `${baseClasses} bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400`;
    case "not cleared":
      return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400`;

    default:
      return `${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400`; // Neutral fallback
  }
};



  const filteredInvoices = useMemo(() => {
    if (isLoading) return [];
    if (error) return [];

    const filtered = invoices.filter((invoice) => {
      // Server-side search is handled by the API, so we only apply client-side filters
      // Normalize status comparison to handle case and whitespace differences
      const invoiceStatus = (invoice.status || "").trim();
      const tabStatus = (activeTab || "").trim();
      const matchesStatus = activeTab === "all" || invoiceStatus === tabStatus;
      const matchesPayment = isHospitalPharmacy || paymentFilter === "all" || invoice.paymentMethod === paymentFilter;
      const matchesCashier = cashierFilter === "all" || invoice.cashier === cashierFilter;
      const matchesDate = filterInvoiceByDate(invoice.date);

      return matchesPayment && matchesCashier && matchesStatus && matchesDate;
    });

    // Debug: Log filtering results
    if (activeTab !== "all") {
      console.log(`[InvoiceHistory] Filtering by status "${activeTab}":`, {
        totalInvoices: invoices.length,
        filteredCount: filtered.length,
        activeTab,
        sampleStatuses: invoices.slice(0, 5).map(inv => inv.status)
      });
    }

    return filtered;
  }, [invoices, activeTab, dateFilter, paymentFilter, cashierFilter, isLoading, error]);

  const uniqueCashiers = useMemo(() => {
    return [...new Set(invoices.map(invoice => invoice.cashier).filter(Boolean))];
  }, [invoices]);

    // Filter customers based on search query
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];

    // First, filter out customers with invalid data
    const validCustomers = customers.filter(customer =>
      customer && (customer.customer_name || customer.name)
    );

    if (!customerSearchQuery.trim()) return validCustomers;

    const query = customerSearchQuery.toLowerCase();
    return validCustomers.filter(customer => {
      // Safely handle potentially undefined values
      const customerName = customer.customer_name?.toLowerCase() || '';
      const customerCode = customer.name?.toLowerCase() || '';

      return customerName.includes(query) || customerCode.includes(query);
    });
  }, [customers, customerSearchQuery]);

  const dispensePrintOrder = useMemo(
    () => invoices.find((inv) => inv.id === openDispensePrintFor) || null,
    [invoices, openDispensePrintFor]
  );

  const dispensePrintMenu =
    openDispensePrintFor &&
    dispensePrintMenuPosition &&
    dispensePrintOrder &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            data-dispense-print-menu
            className="fixed z-[9999] min-w-[220px] max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800"
            style={{
              top: dispensePrintMenuPosition.top,
              right: dispensePrintMenuPosition.right,
              left: "auto",
            }}
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Dispense Order
            </div>
            {salesOrderPrintFormats.map((format) => (
              <button
                key={`so-${format}`}
                type="button"
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-gray-200 dark:hover:bg-gray-700"
                onClick={() => {
                  openDispensePrint("Sales Order", dispensePrintOrder.id, format);
                  setOpenDispensePrintFor(null);
                }}
              >
                <Printer size={13} className="text-slate-400 flex-shrink-0" />
                <span className="truncate">{format}</span>
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  // Get count for each status - filtered by cashier, date, and payment (but not status)
  // This ensures tab counts reflect the current filter selections
  const getStatusCount = (status: string) => {
    // First apply all filters except status
    const invoicesFilteredByOtherFilters = invoices.filter((invoice) => {
      const matchesPayment = isHospitalPharmacy || paymentFilter === "all" || invoice.paymentMethod === paymentFilter;
      const matchesCashier = cashierFilter === "all" || invoice.cashier === cashierFilter;
      const matchesDate = filterInvoiceByDate(invoice.date);
      return matchesPayment && matchesCashier && matchesDate;
    });

    // Then count by status - normalize comparison
    if (status === "all") {
      return invoicesFilteredByOtherFilters.length;
    }
    const normalizedStatus = (status || "").trim();
    return invoicesFilteredByOtherFilters.filter(invoice => {
      const invoiceStatus = (invoice.status || "").trim();
      return invoiceStatus === normalizedStatus;
    }).length;
  };

  // Loading state - only block if nothing loaded yet
  if ((isLoading && invoices.length === 0) || userInfoLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-beveren-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            {isHospitalPharmacy ? "Loading dispense history..." : "Loading invoices..."}
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg max-w-md">
          <h3 className="text-lg font-medium text-red-800 dark:text-red-200">
            {isHospitalPharmacy ? "Error loading dispense history" : "Error loading invoices"}
          </h3>
           {/* @ts-expect-error just ignore */}
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Define render functions before they are used
  const renderFilters = () => (
    <div className="w-full max-w-none bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder={isHospitalPharmacy ? "Search dispense orders..." : "Search invoices..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          {isLoading && invoices.length > 0 && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="animate-spin h-4 w-4 border-2 border-b-transparent border-beveren-500 rounded-full"></div>
            </div>
          )}
        </div>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
        </select>
        <select
          value={cashierFilter}
          onChange={(e) => setCashierFilter(e.target.value)}
          disabled={!isAdminUser}
          className={`px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
            !isAdminUser ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <option value="all">All Cashiers</option>
          {uniqueCashiers.map((cashier) => (
            <option key={cashier} value={cashier}>
              {cashier}
            </option>
          ))}
        </select>
        {!isAdminUser && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Showing only your transactions</p>
        )}
        {!isHospitalPharmacy && (
        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="all">All Payments</option>
          {modes.map((mode) => (
            <option key={mode.name} value={mode.name}>
              {mode.name}
            </option>
          ))}
        </select>
        )}
      </div>
        {hasMore && (
          <div className="mt-3 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Search works on all invoices in the database. Load more invoices to see additional results.
            </p>
          </div>
        )}
    </div>
  );

  const renderSummaryCards = () => (
    <div className={`w-full max-w-none grid grid-cols-1 ${isHospitalPharmacy ? "md:grid-cols-1" : "md:grid-cols-4"} gap-6 mb-6`}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {isHospitalPharmacy ? "Total Dispenses" : "Total Invoices"}
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{filteredInvoices.length}</p>
            {hasMore && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Showing {totalLoaded} of {totalCount}
              </p>
            )}
          </div>
          <FileText className="w-8 h-8 text-orange-600" />
        </div>
      </div>
      {!isHospitalPharmacy && (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Amount</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(filteredInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0), posDetails?.currency || 'USD')}
            </p>
          </div>
          <DollarSign className="w-8 h-8 text-orange-600" />
        </div>
      </div>
      )}
      {!isHospitalPharmacy && (
      <>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Paid Amount</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(
                filteredInvoices
                  .filter(inv => inv.status === "Paid")
                  .reduce((sum, inv) => sum + inv.totalAmount, 0),
                posDetails?.currency || 'USD'
              )}
            </p>
          </div>
          <CheckCircle className="w-8 h-8 text-orange-600" />
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Outstanding</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(
                filteredInvoices
                  .filter(inv => ["Unpaid", "Partly Paid", "Overdue"].includes(inv.status))
                  .reduce((sum, inv) => sum + inv.totalAmount, 0),
                posDetails?.currency || 'USD'
              )}
            </p>
          </div>
          <AlertTriangle className="w-8 h-8 text-orange-600" />
        </div>
      </div>
      </>
      )}
    </div>
  );

  const renderInvoicesTable = () => (
    <div className="w-full max-w-none bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {isHospitalPharmacy
            ? `Dispensed Medicine (${filteredInvoices.length})`
            : `${activeTab === "all" ? "All Invoices" : tabs.find(t => t.id === activeTab)?.name} (${filteredInvoices.length})`}
        </h3>
        {!isHospitalPharmacy && (
        <div className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 rounded-md transition-colors ${
              viewMode === "list"
                ? "bg-white dark:bg-gray-600 text-beveren-600 dark:text-beveren-400 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("cards")}
            className={`p-2 rounded-md transition-colors ${
              viewMode === "cards"
                ? "bg-white dark:bg-gray-600 text-beveren-600 dark:text-beveren-400 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
        </div>
        )}
      </div>

      {viewMode === "list" ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {isHospitalPharmacy ? "Dispense Order" : "Invoice"}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {party.singular}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Cashier
                </th>
                {!isHospitalPharmacy && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Payment
                </th>
                )}
                {!isHospitalPharmacy && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Amount
                </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                {isHospitalPharmacy && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Remark
                  </th>
                )}
                {posDetails?.is_zatca_enabled && !isHospitalPharmacy && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Zatca Status
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
              {filteredInvoices.map((invoice) => {
                const isExpanded = expandedDispenseOrders.has(invoice.id);
                const hospitalColSpan = 6;

                return (
                  <Fragment key={`${activeTab}-${invoice.id}`}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-start gap-2">
                          {isHospitalPharmacy && (
                            <button
                              type="button"
                              onClick={() => toggleDispenseExpand(invoice.id)}
                              className="mt-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                              aria-label={isExpanded ? "Collapse medicines" : "Expand medicines"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">{invoice.id}</div>
                              {isHospitalPharmacy && (
                                <DispenseVisitTypeBadge
                                  visitType={invoice.visitType}
                                  referenceType={invoice.customReferenceType}
                                />
                              )}
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {invoice.date} {invoice.time}
                            </div>
                            {isHospitalPharmacy && invoice.deliveryNoteName && (
                              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                DN: {invoice.deliveryNoteName}
                              </div>
                            )}
                            {isHospitalPharmacy && getReturnedLineCount(invoice) > 0 && (
                              <div className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">
                                {getReturnedLineCount(invoice)} item{getReturnedLineCount(invoice) !== 1 ? "s" : ""} returned
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">{invoice.customer}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {invoice.cashier}
                      </td>
                      {!isHospitalPharmacy && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900 dark:text-white">{invoice.paymentMethod}</span>
                      </td>
                      )}
                      {!isHospitalPharmacy && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {formatCurrency(invoice.totalAmount, invoice.currency)}
                        </div>
                        {invoice.giftCardDiscount > 0 && (
                          <div className="text-xs text-orange-600 dark:text-green-400">
                            -{formatCurrency(invoice.giftCardDiscount, invoice.currency)} gift card
                          </div>
                        )}
                      </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={getStatusBadge(invoice.status)}>{invoice.status}</span>
                      </td>
                      {isHospitalPharmacy && (
                        <td className="px-6 py-4 max-w-xs">
                          <div
                            className="text-sm text-gray-700 dark:text-gray-300 truncate"
                            title={invoice.notes || undefined}
                          >
                            {invoice.notes?.trim() ? invoice.notes : "—"}
                          </div>
                        </td>
                      )}
                      {posDetails?.is_zatca_enabled && !isHospitalPharmacy && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          {/* @ts-expect-error just ignore */}
                          <span className={getStatusBadge(invoice.custom_zatca_submit_status)}>{invoice.custom_zatca_submit_status}</span>
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {isHospitalPharmacy ? (
                          <div className="flex space-x-2">
                            {invoice.isHeldDispense || invoice.status === "Held" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleEditHeldDispenseClick(invoice)}
                                  className="text-blue-600 hover:text-blue-900 flex items-center space-x-1"
                                >
                                  <Edit className="w-4 h-4" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteHeldDispense(invoice)}
                                  className="text-red-600 hover:text-red-900 flex items-center space-x-1"
                                >
                                  <FileMinus className="w-4 h-4" />
                                  <span>Delete</span>
                                </button>
                              </>
                            ) : (
                              <>
                            <button
                              type="button"
                              data-dispense-print-trigger
                              ref={openDispensePrintFor === invoice.id ? dispensePrintButtonRef : null}
                              onClick={() =>
                                setOpenDispensePrintFor((prev) =>
                                  prev === invoice.id ? null : invoice.id
                                )
                              }
                              className="text-slate-600 hover:text-slate-900 flex items-center space-x-1"
                            >
                              <Printer className="w-4 h-4" />
                              <span>Print</span>
                            </button>
                            {canReturnDispenseOrder(invoice) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDispenseOrder(invoice);
                                  setShowDispenseReturn(true);
                                }}
                                className="text-orange-600 hover:text-orange-900 flex items-center space-x-1"
                              >
                                <RotateCcw className="w-4 h-4" />
                                <span>Return</span>
                              </button>
                            )}
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleViewInvoice(invoice)}
                              className="text-beveren-600 hover:text-beveren-900 flex items-center space-x-1"
                            >
                              <Eye className="w-4 h-4" />
                              <span>View</span>
                            </button>
                            {invoice.status === "Draft" && (
                              <button
                                onClick={() => handleEditDraftClick(invoice)}
                                className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 flex items-center space-x-1"
                              >
                                <Edit className="w-4 h-4" />
                                <span>Edit</span>
                              </button>
                            )}
                            {/* @ts-expect-error just ignore */}
                            {["Paid", "Unpaid", "Overdue", "Partly Paid", "Credit Note Issued"].includes(invoice.status) && !invoice.is_return && hasReturnableItems(invoice) && (
                              <button
                                onClick={() => handleSingleReturnClick(invoice)}
                                className="text-orange-600 hover:text-orange-900 flex items-center space-x-1"
                              >
                                <RotateCcw className="w-4 h-4" />
                                <span>Return</span>
                              </button>
                            )}
                            {invoice.status === "Draft" && (
                              <button
                                onClick={() => handleDeleteClick(invoice)}
                                className="text-red-600 hover:text-red-900 flex items-center space-x-1"
                              >
                                <FileMinus className="w-4 h-4" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isHospitalPharmacy && isExpanded && (
                      <tr className="bg-gray-50/80 dark:bg-gray-800/50">
                        <td colSpan={hospitalColSpan} className="px-6 py-4">
                          <div className="ml-6 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-100 dark:bg-gray-700/80">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Medicine</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Batch</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Qty</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Returned</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                {(invoice.items || []).map((item) => {
                                  const returnStatus = getItemReturnStatus(item);
                                  const returnLabel = getItemReturnLabel(returnStatus);
                                  return (
                                  <tr
                                    key={`${invoice.id}-${item.so_detail || item.item_code}`}
                                    className={
                                      returnStatus === "full"
                                        ? "bg-purple-50/70 dark:bg-purple-900/10"
                                        : returnStatus === "partial"
                                          ? "bg-orange-50/50 dark:bg-orange-900/10"
                                          : ""
                                    }
                                  >
                                    <td className="px-4 py-2 text-gray-900 dark:text-white">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <div className="font-medium">{item.item_name || item.name}</div>
                                        {returnLabel && (
                                          <span className={getItemReturnBadgeClass(returnStatus)}>
                                            {returnLabel}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-gray-500">{item.item_code}</div>
                                    </td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{item.batch_no || "—"}</td>
                                    <td className="px-4 py-2 text-right text-gray-900 dark:text-white">{item.qty ?? item.quantity}</td>
                                    <td className="px-4 py-2 text-right">
                                      <span
                                        className={
                                          returnStatus !== "none"
                                            ? "font-medium text-purple-700 dark:text-purple-300"
                                            : "text-gray-600 dark:text-gray-300"
                                        }
                                      >
                                        {item.returned_qty ?? 0}
                                      </span>
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
          {filteredInvoices.map((invoice) => (
            <div
              key={`${activeTab}-${invoice.id}`}
              className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{invoice.id}</div>
                  {isHospitalPharmacy && (
                    <DispenseVisitTypeBadge
                      visitType={invoice.visitType}
                      referenceType={invoice.customReferenceType}
                    />
                  )}
                </div>
                <span className={getStatusBadge(invoice.status)}>{invoice.status}</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{party.singular}:</span>
                  <span className="text-gray-900 dark:text-white">{invoice.customer}</span>
                </div>
                {!isHospitalPharmacy && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Amount:</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(invoice.totalAmount, invoice.currency)}</span>
                </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Date:</span>
                  <span className="text-gray-900 dark:text-white">{invoice.date}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Cashier:</span>
                  <span className="text-gray-900 dark:text-white">{invoice.cashier}</span>
                </div>
                {isHospitalPharmacy && (
                  <div className="flex justify-between text-sm gap-3">
                    <span className="text-gray-600 dark:text-gray-400 flex-shrink-0">Remark:</span>
                    <span
                      className="text-gray-900 dark:text-white text-right truncate"
                      title={invoice.notes || undefined}
                    >
                      {invoice.notes?.trim() ? invoice.notes : "—"}
                    </span>
                  </div>
                )}
                {isHospitalPharmacy && getReturnedLineCount(invoice) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Returned:</span>
                    <span className="text-purple-700 dark:text-purple-300 font-medium">
                      {getReturnedLineCount(invoice)} item{getReturnedLineCount(invoice) !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-4 flex space-x-2">
                {isHospitalPharmacy ? (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleDispenseExpand(invoice.id)}
                      className="flex-1 text-xs px-3 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 transition-colors dark:bg-gray-600 dark:text-gray-200"
                    >
                      {expandedDispenseOrders.has(invoice.id) ? "Hide medicines" : "Show medicines"}
                    </button>
                    {invoice.isHeldDispense || invoice.status === "Held" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEditHeldDispenseClick(invoice)}
                          className="flex-1 text-xs px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteHeldDispense(invoice)}
                          className="flex-1 text-xs px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                    <button
                      type="button"
                      data-dispense-print-trigger
                      onClick={() =>
                        setOpenDispensePrintFor((prev) =>
                          prev === invoice.id ? null : invoice.id
                        )
                      }
                      className="flex-1 text-xs px-3 py-2 bg-slate-600 text-white rounded hover:bg-slate-700 transition-colors"
                    >
                      Print
                    </button>
                    {canReturnDispenseOrder(invoice) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDispenseOrder(invoice);
                          setShowDispenseReturn(true);
                        }}
                        className="flex-1 text-xs px-3 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
                      >
                        Return
                      </button>
                    )}
                      </>
                    )}
                  </>
                ) : (
                <>
                <button
                  onClick={() => handleViewInvoice(invoice)}
                  className="flex-1 text-xs px-3 py-2 bg-beveren-600 text-white rounded hover:bg-beveren-700 transition-colors"
                >
                  View
                </button>
                {invoice.status === "Draft" && (
                  <button
                    onClick={() => handleEditDraftClick(invoice)}
                    className="flex-1 text-xs px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center justify-center space-x-1"
                  >
                    <Edit className="w-3 h-3" />
                    <span>Edit</span>
                  </button>
                )}
                  {["Paid", "Unpaid", "Overdue", "Partly Paid", "Credit Note Issued"].includes(invoice.status) && hasReturnableItems(invoice) && (
                  <button
                    onClick={() => handleSingleReturnClick(invoice)}
                    className="flex-1 text-xs px-3 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
                  >
                    Return
                  </button>
                )}
                </>
                )}
              </div>
              {isHospitalPharmacy && expandedDispenseOrders.has(invoice.id) && (
                <div className="mt-4 space-y-2 border-t border-gray-200 dark:border-gray-600 pt-3">
                  {(invoice.items || []).map((item) => {
                    const returnStatus = getItemReturnStatus(item);
                    const returnLabel = getItemReturnLabel(returnStatus);
                    return (
                    <div
                      key={`${invoice.id}-${item.so_detail || item.item_code}`}
                      className={`flex justify-between gap-3 text-sm rounded-md p-2 ${
                        returnStatus === "full"
                          ? "bg-purple-50 dark:bg-purple-900/20"
                          : returnStatus === "partial"
                            ? "bg-orange-50 dark:bg-orange-900/20"
                            : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium text-gray-900 dark:text-white truncate">
                            {item.item_name || item.name}
                          </div>
                          {returnLabel && (
                            <span className={getItemReturnBadgeClass(returnStatus)}>{returnLabel}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.item_code}
                          {item.batch_no ? ` · Batch ${item.batch_no}` : ""}
                          {(item.returned_qty ?? 0) > 0 ? ` · Returned ${item.returned_qty}` : ""}
                        </div>
                      </div>
                      <div className="text-right text-gray-700 dark:text-gray-200 whitespace-nowrap">
                        {isHospitalPharmacy
                          ? (item.qty ?? item.quantity)
                          : `${item.qty ?? item.quantity} × ${formatCurrency(item.rate ?? 0, invoice.currency)}`}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {hasMore && (
        <div className="flex justify-center mt-8">
          <button
            onClick={loadMore}
            disabled={isLoadingMore}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              isLoadingMore
                ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                : 'bg-beveren-600 text-white hover:bg-beveren-700'
            }`}
          >
            {isLoadingMore ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Loading...</span>
              </div>
            ) : (
              `Load More (${totalLoaded}/${totalCount})`
            )}
          </button>
        </div>
      )}

      {/* Show message when all invoices are loaded */}
      {!hasMore && totalLoaded > 0 && (
        <div className="text-center mt-8 py-4">
          <p className="text-gray-600 dark:text-gray-400">
            {filteredInvoices.length > 0
              ? `Showing ${filteredInvoices.length} ${isHospitalPharmacy ? "dispense" : "invoice"}${filteredInvoices.length !== 1 ? 's' : ''} (${totalLoaded} total loaded)`
              : `All ${totalCount} ${isHospitalPharmacy ? "dispenses" : "invoices"} loaded`
            }
          </p>
        </div>
      )}
    </div>
  );

  const handleViewInvoice = (invoice: SalesInvoice) => {
    if (invoice.isPosDispense) return;
    navigate(`/invoice/${invoice.id}`);
  };


    // Helper function to check if invoice has items that can still be returned
  const hasReturnableItems = (invoice: SalesInvoice) => {
    if (!invoice || !invoice.items) {
      console.log("No invoice or items found for:", invoice?.id);
      return false;
    }

    // NEW RULE: Check invoice age first - all invoices older than 14 days cannot be returned
    const invoiceDate = invoice.posting_date || invoice.date;
    if (invoiceDate) {
      const invoiceDateObj = new Date(invoiceDate);
      const today = new Date();
      const daysSinceInvoice = Math.floor((today.getTime() - invoiceDateObj.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysSinceInvoice > 14) {
        return false; // Invoice is too old
      }
    }

    // Use the canReturn property set by background return data loading
    // @ts-expect-error just ignore
    if (invoice.canReturn !== undefined) {
      //@ts-expect-error just ignore
      return invoice.canReturn;
    }

    // Fallback to old logic if canReturn is not set yet
    // For invoices <= 14 days, check item restrictions
    const hasReturnable = invoice.items.some(item => {
      const soldQty = item.qty || item.quantity || 0;
      const returnedQty = item.returned_qty || 0;
      const hasAvailableQty = returnedQty < soldQty;
      
      // Check if item is non-returnable (Item Group flag)
      if (item.is_non_returnable) {
        return false;
      }
      
      // Check if item is refrigerated (Item flag)
      if (item.is_refrigerated_overdue) {
        return false;
      }
      
      return hasAvailableQty;
    });

    return hasReturnable;
  };



  // Delete invoice handlers
  const handleDeleteClick = (invoice: SalesInvoice) => {
    if (invoice.status !== "Draft") {
      toast.error("Only draft invoices can be deleted");
      return;
    }
    setInvoiceToDelete(invoice);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!invoiceToDelete) return;

    try {
      await deleteDraftInvoice(invoiceToDelete.id);
      toast.success(`Draft invoice ${invoiceToDelete.id} deleted successfully`);
      setShowDeleteConfirm(false);
      setInvoiceToDelete(null);
      // Refresh the invoices list
      window.location.reload();
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      toast.error(error.message || "Failed to delete invoice");
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
    setInvoiceToDelete(null);
  };

  // Edit draft invoice handlers
  const handleEditDraftClick = (invoice: SalesInvoice) => {
    if (invoice.status !== "Draft") {
      toast.error("Only draft invoices can be edited");
      return;
    }
    setSelectedDraftInvoice(invoice);
    setShowEditOptions(true);
  };

  const handleGoToCart = async (invoice: SalesInvoice) => {
    try {
      const success = invoice.isHeldDispense
        ? await addHeldDispenseOrderToCart(invoice.id)
        : await addDraftInvoiceToCart(invoice.id);
      if (success) {
        setShowEditOptions(false);
        setSelectedDraftInvoice(null);
        setTimeout(() => {
          navigate('/pos'); // Navigate directly to POS page
        }, 500);
      }
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error going to cart:", error);
      toast.error(error.message || "Failed to add items to cart");
    }
  };

  const handleEditHeldDispenseClick = (invoice: SalesInvoice) => {
    if (!invoice.isHeldDispense && invoice.status !== "Held") {
      toast.error("Only held dispense orders can be edited");
      return;
    }
    setSelectedDraftInvoice(invoice);
    setShowEditOptions(true);
  };

  const handleDeleteHeldDispense = async (invoice: SalesInvoice) => {
    try {
      await deleteDraftHospitalSalesOrder(invoice.id);
      if (getOriginalHeldDispenseOrderId() === invoice.id) {
        clearHeldDispenseOrderCache();
      }
      toast.success(`Held order ${invoice.id} deleted successfully`);
      refetch();
    } catch (error: unknown) {
      toast.error(extractErrorFromException(error, "Failed to delete held order"));
    }
  };

  const handleSubmitDirect = async (invoice: SalesInvoice) => {
    try {
      await submitDraftInvoice(invoice.id);
      toast.success(`Draft invoice ${invoice.id} submitted successfully`);
      setShowEditOptions(false);
      setSelectedDraftInvoice(null);
      // Refresh the invoices list
      window.location.reload();
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error submitting draft invoice:", error);
      const errorMessage = extractErrorFromException(error, "Failed to submit draft invoice");
      toast.error(errorMessage);
    }
  };

  const handleCloseEditOptions = () => {
    setShowEditOptions(false);
    setSelectedDraftInvoice(null);
  };

  const handleRefund = (invoiceId: string) => {
    handleReturnClick(invoiceId);
    setShowInvoiceModal(false);
  };

  const handleReturnClick = async (invoiceName: string) => {
    try {
      const result = await createSalesReturn(invoiceName);

      navigate(`/invoice/${result.return_invoice}`)
      toast.success(`Invoice returned: ${result.return_invoice}`);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      toast.error(error.message || "Failed to return invoice");
    }
  };

  const handleCancel = (invoiceId: string) => {
    console.log("Cancelling invoice:", invoiceId);
    setShowInvoiceModal(false);
  };

      // Multi-Invoice Return handlers
    const handleMultiReturnClick = () => {
      setSelectedCustomer("");
      setShowMultiReturn(true);
    };

    // Single Invoice Return handlers
    const handleSingleReturnClick = (invoice: SalesInvoice) => {
      setSelectedInvoiceForReturn(invoice);
      setShowSingleReturn(true);
    };

    const handleSingleReturnSuccess = () => {
      setShowSingleReturn(false);
      setSelectedInvoiceForReturn(null);
      // Refresh the invoices list
      window.location.reload();
    };

    const handleDispenseReturnSuccess = () => {
      setShowDispenseReturn(false);
      setSelectedDispenseOrder(null);
      refetch();
    };

  const handleCustomerSelect = (customer: string) => {
    if (!customer) {
      toast.error("Invalid customer selection");
      return;
    }
    setSelectedCustomer(customer);
    setShowCustomerSelection(false);
    setCustomerSearchQuery("");
    setShowMultiReturn(true);
  };

  const handleMultiReturnSuccess = () => {
    // toast.success(`Created ${returnInvoices.length} return invoices successfully`);
    setShowMultiReturn(false);
    setSelectedCustomer("");
  };

  const handleCloseCustomerSelection = () => {
    setShowCustomerSelection(false);
    setCustomerSearchQuery("");
  };

  // Export functionality
  const handleExportInvoices = () => {
    try {
      if (!filteredInvoices || filteredInvoices.length === 0) {
        toast.error("No invoices to export");
        return;
      }

      // Convert invoices to exportable format
      const exportableInvoices: ExportableInvoice[] = filteredInvoices.map(invoice => {
        // Calculate outstanding amount: grand total - amount paid
        const grandTotal = invoice.totalAmount || 0;
        const amountPaid = invoice.amountPaid || 0;
        const outstandingAmount = Math.max(0, grandTotal - amountPaid);

        return {
          name: invoice.id || invoice.name || '',
          customer: invoice.customer || '',
          posting_date: invoice.date || invoice.posting_date || '',
          due_date: '', // Due date is not available in the current data structure
          grand_total: grandTotal,
          outstanding_amount: outstandingAmount,
          status: invoice.status || '',
          mode_of_payment: invoice.paymentMethod || '',
          currency: invoice.currency || 'SAR',
          company: invoice.company || ''
        };
      });

      // Generate filename based on current filters
      const tabName = activeTab === "all" ? "all" : activeTab.toLowerCase();
      const filename = getExportFilename(`invoices_${tabName}`, 'csv');

      // Export to CSV
      exportInvoicesToCSV(exportableInvoices, filename);

      toast.success(`Exported ${exportableInvoices.length} invoices successfully`);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Export error:', error);
      toast.error(`Failed to export invoices: ${error.message}`);
    }
  };

  // Mobile layout: full-width content and persistent bottom navigation
  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900 font-inconsolata">
        {/* Mobile Header */}
        <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                {isHospitalPharmacy ? "Dispense History" : "Invoice History"}
              </h1>
              {!isHospitalPharmacy && (
              <div className="flex items-center space-x-2">
                                  <button
                    onClick={handleMultiReturnClick}
                    className="flex items-center space-x-2 px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm"
                  >
                  <Users className="w-4 h-4" />
                  <span>Multi Return</span>
                </button>
                <button
                  onClick={handleExportInvoices}
                  className="flex items-center space-x-2 px-3 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                </button>
              </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-20 w-[98%] mx-auto px-2 py-4">
          {/* Status Tabs */}
          <div className="mb-6 w-full">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="border-b border-gray-200 dark:border-gray-700">
                <nav className="-mb-px flex space-x-4 overflow-x-auto">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-xs whitespace-nowrap ${
                        activeTab === tab.id
                          ? "border-beveren-500 text-beveren-600 dark:text-beveren-400"
                          : `border-transparent ${tab.color} dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300`
                      }`}
                    >
                      <tab.icon className="w-4 h-4" />
                      <span>{tab.name}</span>
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 rounded-full">
                        {getStatusCount(tab.id)}
                      </span>
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </div>

          {renderFilters()}
          {renderSummaryCards()}
          {renderInvoicesTable()}
        </div>

        {/* Invoice View Modal */}
        <InvoiceViewModal
          invoice={selectedInvoice}
          isOpen={showInvoiceModal}
          onClose={() => setShowInvoiceModal(false)}
          onRefund={handleRefund}
          onCancel={handleCancel}
        />

        {/* Customer Selection Modal */}
        {showCustomerSelection && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Select {party.singular}</h2>
                  <button
                    onClick={handleCloseCustomerSelection}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-6 flex-1 overflow-hidden flex flex-col">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Choose a {party.lower} to process multi-invoice returns
                </p>

                {/* Search Bar */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="text"
                    placeholder={`Search ${party.plural.toLowerCase()} by name or ID...`}
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Customer List */}
                <div className="flex-1 overflow-y-auto space-y-2">
                  {filteredCustomers && filteredCustomers.length > 0 ? (
                    filteredCustomers.map((customer) => (
                      <button

                        key={customer.name || customer.customer_name || Math.random()}
                        onClick={() => handleCustomerSelect(customer.name || customer.customer_name)}
                        className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="font-medium text-gray-900 dark:text-white">
                          {customer.customer_name || customer.name || `Unknown ${party.singular}`}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {customer.name || customer.customer_name || 'No ID'}
                        </div>
                      </button>
                    ))
                  ) : customerSearchQuery.trim() ? (
                    <div className="text-center py-8">
                      <div className="text-gray-500 dark:text-gray-400">No {party.plural.toLowerCase()} found matching "{customerSearchQuery}"</div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="text-gray-500 dark:text-gray-400">No {party.plural.toLowerCase()} found</div>
                    </div>
                  )}
                </div>

                {/* Results Counter */}
                {filteredCustomers && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                      {customerSearchQuery.trim()
                        ? `${filteredCustomers.length} of ${customers?.length || 0} ${party.plural.toLowerCase()}`
                        : `${customers?.length || 0} ${party.plural.toLowerCase()} total`
                      }
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Multi-Invoice Return Modal */}
        <MultiInvoiceReturn
          customer={selectedCustomer}
          isOpen={showMultiReturn}
          onClose={() => setShowMultiReturn(false)}
          onSuccess={handleMultiReturnSuccess}
          // @ts-expect-error just ignore
          customers={customers}
        />


        {/* Bottom Navigation */}
        <BottomNavigation />
      </div>
    );
  }



  return (

    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex pb-12">
      <div className="flex-1 flex flex-col overflow-hidden ml-20">
        {/* Header */}
        <div className="fixed top-0 left-20 right-0 z-50 bg-beveren-50 dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">

                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {isHospitalPharmacy ? "Dispense History" : "Invoice History"}
                </h1>
              </div>
              {!isHospitalPharmacy && (
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleMultiReturnClick}
                  className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                >
                  <FileMinus className="w-4 h-4" />
                  <span>Multi-Invoice Return</span>
                </button>
                <button
                  onClick={handleExportInvoices}
                  className="flex items-center space-x-2 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                </button>
              </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 px-6 py-8 mt-16 max-w-none">
          {/* Status Tabs - Now full width like the table */}
          <div className="mb-8 w-full max-w-none">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <div className="border-b border-gray-200 dark:border-gray-700">
                <nav className="-mb-px flex space-x-8 overflow-x-auto">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                        activeTab === tab.id
                          ? "border-beveren-500 text-beveren-600 dark:text-beveren-400"
                          : `border-transparent ${tab.color} dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300`
                      }`}
                    >
                      <tab.icon className="w-5 h-5" />
                      <span>{tab.name}</span>
                      <span className="ml-2 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded-full">
                        {getStatusCount(tab.id)}
                      </span>
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </div>

          {/* Filters */}
          {renderFilters()}

          {/* Summary Cards */}
          {renderSummaryCards()}

          {/* Invoices Table/Grid */}
          {renderInvoicesTable()}
        </div>

        {/* Invoice View Modal */}
        <InvoiceViewModal
          invoice={selectedInvoice}
          isOpen={showInvoiceModal}
          onClose={() => setShowInvoiceModal(false)}
          onRefund={handleRefund}
          onCancel={handleCancel}
        />

        {/* Customer Selection Modal */}
        {showCustomerSelection && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Select {party.singular}</h2>
                  <button
                    onClick={handleCloseCustomerSelection}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-6 flex-1 overflow-hidden flex flex-col">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Choose a {party.lower} to process multi-invoice returns
                </p>

                {/* Search Bar */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="text"
                    placeholder={`Search ${party.plural.toLowerCase()} by name or ID...`}
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Customer List */}
                <div className="flex-1 overflow-y-auto space-y-2">
                  {filteredCustomers && filteredCustomers.length > 0 ? (
                    filteredCustomers.map((customer) => (
                      <button
                        key={customer.name || customer.customer_name || Math.random()}
                        onClick={() => handleCustomerSelect(customer.name || customer.customer_name)}
                        className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="font-medium text-gray-900 dark:text-white">
                          {customer.customer_name || customer.name || `Unknown ${party.singular}`}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {customer.name || customer.customer_name || 'No ID'}
                        </div>
                      </button>
                    ))
                  ) : customerSearchQuery.trim() ? (
                    <div className="text-center py-8">
                      <div className="text-gray-500 dark:text-gray-400">No {party.plural.toLowerCase()} found matching "{customerSearchQuery}"</div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="text-gray-500 dark:text-gray-400">No {party.plural.toLowerCase()} found</div>
                    </div>
                  )}
                </div>

                {/* Results Counter */}
                {filteredCustomers && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                      {customerSearchQuery.trim()
                        ? `${filteredCustomers.length} of ${customers?.length || 0} ${party.plural.toLowerCase()}`
                        : `${customers?.length || 0} ${party.plural.toLowerCase()} total`
                      }
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Multi-Invoice Return Modal */}
        <MultiInvoiceReturn
          customer={selectedCustomer}
          isOpen={showMultiReturn}
          onClose={() => setShowMultiReturn(false)}
          onSuccess={handleMultiReturnSuccess}
          // @ts-expect-error just ignore
          customers={customers}
        />


        {/* Single Invoice Return Modal */}
        <SingleInvoiceReturn
          invoice={selectedInvoiceForReturn}
          isOpen={showSingleReturn}
          onClose={() => setShowSingleReturn(false)}
          onSuccess={handleSingleReturnSuccess}
        />

        <DispenseOrderReturn
          order={selectedDispenseOrder}
          isOpen={showDispenseReturn}
          onClose={() => setShowDispenseReturn(false)}
          onSuccess={handleDispenseReturnSuccess}
        />

        {dispensePrintMenu}

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          title="Delete Draft Invoice"
          message={`Are you sure you want to delete draft invoice ${invoiceToDelete?.id}? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        />

        {/* Original Draft Invoice Edit Options Modal */}
        {showEditOptions && selectedDraftInvoice && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md relative">
              {/* Click outside to close */}
              <div
                className="absolute inset-0 -z-10"
                onClick={handleCloseEditOptions}
              />
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedDraftInvoice.isHeldDispense || selectedDraftInvoice.status === "Held"
                      ? "Edit Held Order"
                      : "Edit Draft Invoice"}
                  </h2>
                  <button
                    onClick={handleCloseEditOptions}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  {selectedDraftInvoice.isHeldDispense || selectedDraftInvoice.status === "Held"
                    ? `Order: ${selectedDraftInvoice.id}`
                    : `Invoice: ${selectedDraftInvoice.id}`}
                </p>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                  {selectedDraftInvoice.isHeldDispense || selectedDraftInvoice.status === "Held"
                    ? "Resume this held dispense order in the cart."
                    : "What would you like to do with this draft invoice?"}
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => handleGoToCart(selectedDraftInvoice)}
                    className="w-full flex items-center justify-center space-x-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                  >
                    <ShoppingCart className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <span className="font-medium text-blue-900 dark:text-blue-100">Go to Cart</span>
                  </button>
                  {!(selectedDraftInvoice.isHeldDispense || selectedDraftInvoice.status === "Held") && (
                  <button
                    onClick={() => handleSubmitDirect(selectedDraftInvoice)}
                    className="w-full flex items-center justify-center space-x-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                  >
                    <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                    <span className="font-medium text-green-900 dark:text-green-100">Submit</span>
                  </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
