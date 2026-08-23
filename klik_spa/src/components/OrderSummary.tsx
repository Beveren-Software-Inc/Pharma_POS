"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Minus,
  Plus,
  X,
  Search,
  UserPlus,
  User,
  Building,
  Pill,
  Pencil,
  Printer,
  CopyPlus,
} from "lucide-react";
import type { CartItem, GiftCoupon } from "../../types";
import type { Customer } from "../types/customer";
import PaymentDialog from "./PaymentDialog";
import AddCustomerModal from "./AddCustomerModal";
import InpatientMedicationOrdersModal from "./InpatientMedicationOrdersModal";
import PatientDetailsModal from "./PatientDetailsModal";
import AdditionalAmountModal from "./AdditionalAmountModal";
import PharmacyServiceModal from "./PharmacyServiceModal";
import type { PharmacyServiceItem } from "../services/pharmacyService";
import { createDraftSalesInvoice } from "../services/salesInvoice";
import { useCustomers } from "../hooks/useCustomers";
import { useProducts } from "../hooks/useProducts";
import { toast } from "react-toastify";
import { extractErrorFromException } from "../utils/errorExtraction";
import { getBatches } from "../utils/batch";
import {
  auditCartBatchExpiry,
  formatBatchExpiryMessage,
  getBatchExpiryStatus,
  selectionExpiryToastCopy,
} from "../utils/batchExpiry";
import { getSerials } from "../utils/serial";
import {
  getDispensingLots,
  formatDispensingLotLabel,
  buildSerialLotMap,
  joinDispensingLotNames,
  getDispensingLotCacheKey,
  setDispensingLotsCache,
  filterLotsByBatch,
  resolveSerialNumbersFromLotNames,
  type DispensingLotOption,
} from "../utils/dispensingLot";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { useItemTaxTemplates } from "../hooks/useItemTaxTemplates";
import { useItemTaxTemplateRates } from "../hooks/useItemTaxTemplateRates";
import { useFreeItemTaxAmount } from "../hooks/useFreeItemTaxAmount";
import { useCustomerStatistics } from "../hooks/useCustomerStatistics";
import { useCustomerPermission } from "../hooks/useCustomerPermission";
import { useCartStore } from "../stores/cartStore";
import { useUiStore } from "../stores/uiStore";
import { getPrescriptionFrequencies, type PrescriptionFrequency } from "../services/prescriptionFrequencyService";
import { searchPatients, getPendingInpatientMedicationOrders, getPatientMedicationOrderHistory, getPatientLegacyDispensedMedications, getSubscriptionMedicationPlans, getPatientHistorySummary, createPatientVisit, getPatientVisitDate, resolvePatientForCustomer, resolveCustomerForPatient, resolveMedicationItemCode, resolveMedicationDisplayName, resolveLegacyMedicationItemCode, resolveLegacyMedicationDisplayName, legacyMedicationLineKey, resolveSubscriptionItemCode, resolveSubscriptionItemDisplayName, subscriptionMedicationLineKey, getPatientDisplayName, getPatientSecondaryLabel, type Patient, type InpatientMedicationOrder, type LegacyDispensedTransaction, type SubscriptionMedicationPlan, type PatientHistorySummary, type ResolvedCustomer } from "../services/patientService";
import { getItemPriceForCustomer } from "../services/dynamicPricing";
import { getItemUOMsAndPrices } from "../services/uomService";
import { createHospitalSalesOrder, createDraftHospitalSalesOrder, getBatchLabelDetails } from "../services/salesOrder";
import { getCachedDraftInvoiceItems } from "../utils/draftInvoiceCache";
import {
  cacheHeldDispenseOrder,
  clearHeldDispenseOrderCache,
  getCachedHeldDispenseOrder,
  getOriginalHeldDispenseOrderId,
} from "../utils/heldDispenseOrderCache";
import { getPartyLabels } from "../utils/partyLabels";
import {
  getUomConversionFactor,
  normalizeUom,
  resolveHospitalCartUomDetails,
  resolveMedicationOrderUom,
} from "../utils/hospitalCartUom";
import { POS_BEFORE_NAVIGATE_EVENT } from "../utils/navigation";


interface OrderSummaryProps {
  cartItems: CartItem[];
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemoveItem?: (id: string) => void;
  onClearCart?: () => void;
  appliedCoupons: GiftCoupon[];
  onApplyCoupon: (coupon: GiftCoupon) => void;
  onRemoveCoupon: (couponCode: string) => void;
  isMobile?: boolean;
}

interface DispensedLabelItem {
  itemCode: string;
  itemName: string;
  dosage: string;
  frequency: string;
  batchNo: string;
  expiryDate: string;
}

const getCartSignature = (items: CartItem[]) =>
  items
    .map((item) => {
      const line = item as CartItem & { cartLineId?: string; batch_no?: string; serial_no?: string; medicationOrder?: string; medicationOrders?: string[] };
      return [
        line.cartLineId || item.id,
        item.id,
        item.quantity,
        line.batch_no || "",
        line.serial_no || "",
        line.medicationOrder || "",
        (line.medicationOrders || []).join("|"),
      ].join("::");
    })
    .sort()
    .join("||");

const MEDICATION_LABEL_CSS = `
  body { font-family: Arial, sans-serif; margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: 2.299in 1.5in; margin: 0; }
  .label-page { width: 2.299in; height: 1.5in; padding: 5px; box-sizing: border-box; page-break-after: always; }
  .label-page:last-child { page-break-after: auto; }
  .medication-label { width: 100%; height: 100%; border: 1px solid #000; padding: 4px 5px 5px 5px; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-start; }
  .title { font-size: 8px; font-weight: 700; text-align: center; margin: 0 0 4px 0; }
  .item { font-size: 6px; font-weight: 700; text-align: center; margin: 0 0 4px 0; line-height: 1.15; }
  .detail-row { font-size: 7px; line-height: 1.25; margin-bottom: 2px; }
`;

/** Shared cart line field styles — inputs and select triggers use the same size/spacing */
const cartFieldLabelClass =
  "block text-xs font-normal text-gray-500 dark:text-gray-400 mb-1 leading-tight";

const cartFieldCellClass = "min-w-0 flex flex-col";

const cartFieldInputClass =
  "w-full h-9 text-sm px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white";

const cartFieldSelectTriggerClass = `${cartFieldInputClass} text-left flex items-center justify-between gap-2 min-h-9`;

const cartFieldMultiSelectTriggerClass = `${cartFieldInputClass} min-h-9 max-h-9 overflow-hidden text-left flex items-center gap-1`;

const cartFieldActionButtonClass =
  "w-full h-9 text-sm font-normal px-3 rounded-md border border-beveren-500 text-beveren-600 dark:text-beveren-400 hover:bg-beveren-50 dark:hover:bg-beveren-900/20 transition-colors flex items-center justify-center";

const cartFieldDropdownFilterClass =
  "w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white";

const cartFieldDropdownItemClass =
  "w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700";

// Component to handle quantity input with local state
interface QuantityInputProps {
  item: CartItem;
  onUpdateQuantity: (id: string, quantity: number) => void;
  isMobile?: boolean;
}

const QuantityInput = ({ item, onUpdateQuantity, isMobile }: QuantityInputProps) => {
  const [inputValue, setInputValue] = useState(item.quantity.toString());
  const [isEditing, setIsEditing] = useState(false);

  // Update input value when item quantity changes externally
  useEffect(() => {
    if (!isEditing) {
      setInputValue(item.quantity.toString());
    }
  }, [item.quantity, isEditing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
  };

  const handleBlur = () => {
    setIsEditing(false);
    const numValue = Number(inputValue);

    if (isNaN(numValue) || numValue <= 0) {
      // Invalid input - reset to original value
      setInputValue(item.quantity.toString());
      if (numValue <= 0) {
        onUpdateQuantity(item.id, 0);
      }
    } else {
      // Valid input - update quantity
      setInputValue(numValue.toString());
      onUpdateQuantity(item.id, numValue);
    }
  };

  const handleFocus = () => {
    setIsEditing(true);
  };

  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={inputValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={cartFieldInputClass}
    />
  );
};

interface ServiceRateInputProps {
  lineKey: string;
  price: number;
  onRateChange: (lineKey: string, rate: number) => void;
  isMobile?: boolean;
}

const ServiceRateInput = ({ lineKey, price, onRateChange, isMobile }: ServiceRateInputProps) => {
  const [inputValue, setInputValue] = useState(price.toString());
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(price.toString());
    }
  }, [price, isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    const numValue = Number(inputValue);
    if (isNaN(numValue) || numValue < 0) {
      setInputValue(price.toString());
      return;
    }
    setInputValue(numValue.toString());
    onRateChange(lineKey, numValue);
  };

  return (
    <input
      type="number"
      step="0.001"
      min="0"
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onFocus={() => setIsEditing(true)}
      onBlur={handleBlur}
      className={cartFieldInputClass}
    />
  );
};

// Component to handle dosage input with local state (allows empty + decimals)
interface DosageInputProps {
  itemId: string;
  value: string | number | null | undefined;
  onChange: (itemId: string, value: string) => void;
  isMobile?: boolean;
}

const DosageInput = ({ itemId, value, onChange, isMobile }: DosageInputProps) => {
  const initial = value === null || value === undefined ? "" : String(value);
  const [inputValue, setInputValue] = useState<string>(initial);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(value === null || value === undefined ? "" : String(value));
    }
  }, [value, isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    const trimmed = inputValue.trim();
    onChange(itemId, trimmed);
    setInputValue(trimmed);
  };

  return (
    <input
      type="text"
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onFocus={() => setIsEditing(true)}
      onBlur={handleBlur}
      placeholder="e.g. 1 tablet"
      className={cartFieldInputClass}
    />
  );
};

function formatBatchExpiryLabel(expiry?: string | null): string | null {
  if (!expiry?.trim()) return null;
  const parsed = new Date(expiry);
  if (Number.isNaN(parsed.getTime())) return expiry.trim();
  return parsed.toLocaleDateString();
}

function warnOnBatchExpirySelection(itemName: string, batchId: string, expiry?: string | null) {
  const copy = selectionExpiryToastCopy(itemName, batchId, expiry);
  if (!copy) return;
  if (copy.status === "expired") {
    toast.error(`Expired batch: ${copy.message}. Do not dispense.`);
  } else {
    toast.warning(`Near-expiry batch: ${copy.message}`);
  }
}

// Simple UOM Select Field Component
interface UOMSelectFieldProps {
  item: CartItem;
  onUOMChange: (itemId: string, selectedUOM: string, newPrice: number, conversionFactor: number) => void;
  isMobile?: boolean;
  selectedCustomer?: { id: string } | null;
}

const UOMSelectField = ({ item, onUOMChange, isMobile, selectedCustomer }: UOMSelectFieldProps) => {
  const [availableUOMs, setAvailableUOMs] = useState<string[]>(['Nos']);
  const [selectedUOM, setSelectedUOM] = useState<string>(item.uom || 'Nos'); //Mania: Local state for selected UOM
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  useEffect(() => {
    const loadItemSpecificUOMs = async () => {
      try {
        // Use item_code if available, otherwise fallback to item.id
        const itemCode = item.item_code || item.id;
        if (itemCode) {
          // console.log(`📡 Loading UOMs for item: ${itemCode} with customer: ${selectedCustomer?.id || 'None'}`);
          const customerParam = selectedCustomer?.id ? `&customer=${selectedCustomer.id}` : '';
          const response = await fetch(`/api/method/klik_pos.api.item.get_item_uoms_and_prices?item_code=${itemCode}${customerParam}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          });

          if (response.ok) {
            const data = await response.json();

            if (data?.message?.uoms) {
              //eslint-disable-next-line @typescript-eslint/no-explicit-any
              const uoms = data.message.uoms.map((uom: any) => uom.uom);
              setAvailableUOMs(uoms);
            } else {
              setAvailableUOMs(['Nos']);
            }
          } else {
            setAvailableUOMs(['Nos']);
          }
        } else {
          setAvailableUOMs(['Nos']);
        }
      } catch (error) {
        console.error('❌ Error loading item-specific UOMs:', error);
        setAvailableUOMs(['Nos']);
      }
    };

    loadItemSpecificUOMs();
  }, [item.id, item.item_code, selectedCustomer?.id]);

  // Sync local state with item UOM changes
  useEffect(() => {
    setSelectedUOM(item.uom || 'Nos');
  }, [item.uom]);

  // Filter UOMs based on search query
  const filteredUOMs = availableUOMs.filter(uom =>
    uom.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUOMSelect = async (newUOM: string) => {


    // Update local state immediately for UI responsiveness
    setSelectedUOM(newUOM);
    setIsDropdownOpen(false);
    setSearchQuery('');

    // Update UOM and price using item UOMs and prices API
    try {
      // Use item_code if available, otherwise fallback to item.id
      const itemCode = item.item_code || item.id;
      if (itemCode) {
        // console.log(`📡 API Call: get_item_uoms_and_prices for ${itemCode} with customer: ${selectedCustomer?.id || 'None'}`);
        const customerParam = selectedCustomer?.id ? `&customer=${selectedCustomer.id}` : '';
        const response = await fetch(`/api/method/klik_pos.api.item.get_item_uoms_and_prices?item_code=${itemCode}${customerParam}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();
          // console.log(`📦 API Response:`, data.message);

          if (data?.message?.uoms) {
            //eslint-disable-next-line @typescript-eslint/no-explicit-any
            const selectedUOMData = data.message.uoms.find((uom: any) => uom.uom === newUOM);
            if (selectedUOMData && selectedUOMData.price !== undefined) {
              onUOMChange(item.id, newUOM, selectedUOMData.price, selectedUOMData.conversion_factor || 1);
            } else {
              console.warn(`⚠️ UOM data not found for ${newUOM}. Available UOMs:`, data.message.uoms.map((u: any) => u.uom));
              // Fallback: try to calculate price using fetch_item_price API
              try {
                const itemCode = item.item_code || item.id;
                const customerParam = selectedCustomer?.id ? `&customer=${selectedCustomer.id}` : '';
                const priceResponse = await fetch(`/api/method/klik_pos.api.item.get_item_price_for_customer?item_code=${itemCode}&uom=${encodeURIComponent(newUOM)}${customerParam}`, {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include'
                });
                if (priceResponse.ok) {
                  const priceData = await priceResponse.json();
                  if (priceData?.message?.success && priceData.message.price > 0) {
                    onUOMChange(item.id, newUOM, priceData.message.price, selectedUOMData?.conversion_factor || 1);
                  } else {
                    console.error(`❌ Fallback API returned invalid price for ${newUOM}`);
                  }
                }
              } catch (fallbackError) {
                console.error(`❌ Error in fallback price fetch for ${newUOM}:`, fallbackError);
              }
            }
          } else {
            console.error('❌ No UOMs data in API response');
          }
        } else {
          // API call failed
        }
      } else {
        // No item_code or id found for item
      }
    } catch (error) {
      console.error('❌ Error fetching UOM pricing:', error);
    }
  };

  return (
    <div className="relative">
      {/* UOM Display Button */}
      <button
        type="button"
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className={cartFieldSelectTriggerClass}
      >
        <span className="truncate">{selectedUOM}</span>
        <svg className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-hidden">
          {/* Search Input */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-600">
            <input
              type="text"
              placeholder="Search UOM..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cartFieldDropdownFilterClass}
              autoFocus
            />
          </div>

          {/* UOM List */}
          <div className="max-h-48 overflow-y-auto">
            {filteredUOMs.length > 0 ? (
              filteredUOMs.map((uom) => (
                <button
                  key={uom}
                  type="button"
                  onClick={() => handleUOMSelect(uom)}
                  className={`${cartFieldDropdownItemClass} ${
                    uom === selectedUOM ? 'bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400' : 'text-gray-900 dark:text-white'
                  }`}
                >
                  {uom}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                No UOMs found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Compact searchable dropdown for Batch selection
interface BatchSelectFieldProps {
  itemId: string;
  itemCode: string;
  options: { batch_id: string; qty: number; expiry_date?: string | null }[];
  value: string;
  onChange: (value: string, availableQty: number) => void;
  isMobile?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BatchSelectField = ({ itemId: _itemId, itemCode: _itemCode, options, value, onChange, isMobile }: BatchSelectFieldProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filtered = options.filter(o => o.batch_id.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSelect = (batchId: string) => {
    const selectedQty = options.find(b => b.batch_id === batchId)?.qty || 0;
    onChange(batchId, selectedQty);
    setIsOpen(false);
    setQuery("");
  };

  const formatOptionLabel = (b: { batch_id: string; qty: number; expiry_date?: string | null }) => {
    const expiryLabel = formatBatchExpiryLabel(b.expiry_date);
    const status = getBatchExpiryStatus(b.expiry_date);
    const statusTag =
      status === "expired" ? "EXPIRED" : status === "near_expiry" ? "NEAR EXPIRY" : null;
    const parts = [`${b.batch_id} — qty ${b.qty}`];
    if (expiryLabel) parts.push(`exp ${expiryLabel}`);
    if (statusTag) parts.push(statusTag);
    return parts.join(" · ");
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cartFieldSelectTriggerClass}
      >
        <span className="truncate">{value || "Select Batch"}</span>
        <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-44 overflow-hidden">
          <div className="p-2 border-b border-gray-200 dark:border-gray-600">
            <input
              type="text"
              placeholder="Filter batch..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cartFieldDropdownFilterClass}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="max-h-36 overflow-y-auto">
            {filtered.length > 0 ? filtered.map((b) => {
              const status = getBatchExpiryStatus(b.expiry_date);
              const tone =
                status === "expired"
                  ? "text-red-700 dark:text-red-300"
                  : status === "near_expiry"
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-gray-900 dark:text-white";
              return (
              <button
                key={b.batch_id}
                type="button"
                onClick={() => handleSelect(b.batch_id)}
                className={`${cartFieldDropdownItemClass} ${tone} ${value === b.batch_id ? 'bg-beveren-50 dark:bg-beveren-900/20' : ''}`}
              >
                {formatOptionLabel(b)}
              </button>
            );}) : (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


// Compact multi-select searchable dropdown for Serial selection
// interface SerialSelectFieldProps {
//   itemId: string;
//   itemCode: string;
//   options: string[];
//   value: string; // comma-separated: "SN001,SN002,SN003"
//   onChange: (value: string) => void;
//   isMobile?: boolean;
// }

// const SerialSelectField = ({ itemId: _itemId, itemCode: _itemCode, options, value, onChange, isMobile }: SerialSelectFieldProps) => {
//   const [isOpen, setIsOpen] = useState(false);
//   const [query, setQuery] = useState("");

//   // Parse current value into a Set of selected serials
//   const selected = new Set(
//     value ? value.split(",").map(s => s.trim()).filter(Boolean) : []
//   );

//   const filtered = options.filter(sn =>
//     sn.toLowerCase().includes(query.toLowerCase())
//   );

//   const toggleSerial = (sn: string) => {
//     const next = new Set(selected);
//     if (next.has(sn)) {
//       next.delete(sn);
//     } else {
//       next.add(sn);
//     }
//     onChange(Array.from(next).join(","));
//   };

//   const removeSerial = (sn: string, e: React.MouseEvent) => {
//     e.stopPropagation();
//     const next = new Set(selected);
//     next.delete(sn);
//     onChange(Array.from(next).join(","));
//   };

//   const selectedArray = Array.from(selected);
//   const count = selectedArray.length;

//   return (
//     <div className="relative">
//       {/* Trigger button — shows tags when serials selected */}
//       <button
//         type="button"
//         onClick={() => setIsOpen(!isOpen)}
//         className={`w-full ${isMobile ? "text-xs" : "text-xs"} px-2 py-1 min-h-[30px] border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-left flex flex-wrap items-center gap-1`}
//       >
//         {count === 0 ? (
//           <span className="text-gray-400 dark:text-gray-500">Select Serial(s)</span>
//         ) : (
//           <>
//             {selectedArray.map(sn => (
//               <span
//                 key={sn}
//                 className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-beveren-100 dark:bg-beveren-900/30 text-beveren-700 dark:text-beveren-300 rounded text-xs font-medium"
//               >
//                 {sn}
//                 <span
//                   role="button"
//                   tabIndex={0}
//                   onClick={(e) => removeSerial(sn, e)}
//                   onKeyDown={(e) => e.key === 'Enter' && removeSerial(sn, e as unknown as React.MouseEvent)}
//                   className="hover:text-red-500 cursor-pointer leading-none"
//                 >
//                   ×
//                 </span>
//               </span>
//             ))}
//           </>
//         )}
//         <svg
//           className={`w-3 h-3 ml-auto flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
//           fill="none" stroke="currentColor" viewBox="0 0 24 24"
//         >
//           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
//         </svg>
//       </button>

//       {/* Dropdown */}
//       {isOpen && (
//         <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-52 overflow-hidden">
//           {/* Search */}
//           <div className="p-1 border-b border-gray-200 dark:border-gray-600">
//             <input
//               type="text"
//               placeholder="Filter serial..."
//               value={query}
//               onChange={(e) => setQuery(e.target.value)}
//               className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
//               autoFocus
//             />
//           </div>

//           {/* Count indicator */}
//           {count > 0 && (
//             <div className="px-2 py-1 text-xs text-beveren-600 dark:text-beveren-400 bg-beveren-50 dark:bg-beveren-900/20 border-b border-beveren-100 dark:border-beveren-800 flex items-center justify-between">
//               <span>{count} selected</span>
//               <button
//                 type="button"
//                 onClick={() => onChange("")}
//                 className="text-red-500 hover:text-red-700 text-xs"
//               >
//                 Clear all
//               </button>
//             </div>
//           )}

//           {/* Serial list with checkboxes */}
//           <div className="max-h-36 overflow-y-auto">
//             {filtered.length > 0 ? (
//               filtered.map((sn) => {
//                 const isSelected = selected.has(sn);
//                 return (
//                   <button
//                     key={sn}
//                     type="button"
//                     onClick={() => toggleSerial(sn)}
//                     className={`w-full px-2 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${
//                       isSelected
//                         ? 'bg-beveren-50 dark:bg-beveren-900/20 text-beveren-700 dark:text-beveren-300'
//                         : 'text-gray-900 dark:text-white'
//                     }`}
//                   >
//                     {/* Checkbox */}
//                     <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${
//                       isSelected
//                         ? 'bg-beveren-600 border-beveren-600'
//                         : 'border-gray-300 dark:border-gray-500'
//                     }`}>
//                       {isSelected && (
//                         <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
//                         </svg>
//                       )}
//                     </span>
//                     {sn}
//                   </button>
//                 );
//               })
//             ) : (
//               <div className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400 text-center">
//                 No serials found
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

export type SerialSelectOption = string | { value: string; label: string };

function normalizeSerialOptions(options: SerialSelectOption[]): { value: string; label: string }[] {
  return options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o
  );
}

// Compact multi-select searchable dropdown for Serial / Dispensing Lot selection
interface SerialSelectFieldProps {
  itemId: string;
  itemCode: string;
  options: SerialSelectOption[];
  value: string; // comma-separated serial values
  onChange: (value: string) => void;
  isMobile?: boolean;
  emptyLabel?: string;
}

const SerialSelectField = ({
  itemId: _itemId,
  itemCode: _itemCode,
  options,
  value,
  onChange,
  isMobile,
  emptyLabel = "Select Serial(s)",
}: SerialSelectFieldProps) => {
  const normalizedOptions = normalizeSerialOptions(options);
  const labelByValue = Object.fromEntries(
    normalizedOptions.map((o) => [o.value, o.label])
  );
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery(""); // Reset query when closing
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Parse current value into a Set of selected serials
  const selected = new Set(
    value ? value.split(",").map(s => s.trim()).filter(Boolean) : []
  );

  const filtered = normalizedOptions.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()) ||
    o.value.toLowerCase().includes(query.toLowerCase())
  );

  const toggleSerial = (sn: string) => {
    const next = new Set(selected);
    if (next.has(sn)) {
      next.delete(sn);
    } else {
      next.add(sn);
    }
    onChange(Array.from(next).join(","));
  };

  const displayLabel = (sn: string) => {
    const full = labelByValue[sn] || sn;
    return full.length > 24 ? `${full.slice(0, 22)}...` : full;
  };

  const removeSerial = (sn: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selected);
    next.delete(sn);
    onChange(Array.from(next).join(","));
  };

  const selectedArray = Array.from(selected);
  const count = selectedArray.length;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button — shows tags when serials selected */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cartFieldMultiSelectTriggerClass}
      >
        {count === 0 ? (
          <span className="text-gray-400 dark:text-gray-500">{emptyLabel}</span>
        ) : (
          <>
            {selectedArray.slice(0, 3).map(sn => (
              <span
                key={sn}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-beveren-100 dark:bg-beveren-900/30 text-beveren-700 dark:text-beveren-300 rounded text-xs font-medium"
                title={labelByValue[sn] || sn}
              >
                {displayLabel(sn)}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => removeSerial(sn, e)}
                  onKeyDown={(e) => e.key === 'Enter' && removeSerial(sn, e as unknown as React.MouseEvent)}
                  className="hover:text-red-500 cursor-pointer leading-none"
                >
                  ×
                </span>
              </span>
            ))}
            {count > 3 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                +{count - 3} more
              </span>
            )}
          </>
        )}
        <svg
          className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-52 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-600">
            <input
              type="text"
              placeholder="Filter serial..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cartFieldDropdownFilterClass}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Count indicator */}
          {count > 0 && (
            <div className="px-2 py-1 text-xs text-beveren-600 dark:text-beveren-400 bg-beveren-50 dark:bg-beveren-900/20 border-b border-beveren-100 dark:border-beveren-800 flex items-center justify-between">
              <span>{count} selected</span>
              <button
                type="button"
                onClick={() => onChange("")}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Serial list with checkboxes */}
          <div className="max-h-36 overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map((opt) => {
                const isSelected = selected.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleSerial(opt.value)}
                    className={`${cartFieldDropdownItemClass} flex items-center gap-2 ${
                      isSelected
                        ? 'bg-beveren-50 dark:bg-beveren-900/20 text-beveren-700 dark:text-beveren-300'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${
                      isSelected
                        ? 'bg-beveren-600 border-beveren-600'
                        : 'border-gray-300 dark:border-gray-500'
                    }`}>
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })
            ) : (
              <div className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                No serials found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Compact searchable dropdown for Prescription Frequency selection
interface DosageSelectFieldProps {
  itemId: string;
  options: PrescriptionFrequency[];
  value: string;
  onChange: (value: string) => void;
  isMobile?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DosageSelectField = ({ itemId: _itemId, options, value, onChange, isMobile }: DosageSelectFieldProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filtered = options.filter(freq =>
    (freq.name || "").toLowerCase().includes(query.toLowerCase()) ||
    (freq.frequency || freq.dosage || freq.prescription_frequency || "").toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSelect = (freqName: string) => {
    onChange(freqName);
    setIsOpen(false);
    setQuery("");
  };

  const getDisplayName = (freq: PrescriptionFrequency) => {
    return freq.frequency || freq.prescription_frequency || freq.dosage || freq.name || "";
  };

  const selectedLabel =
    options.find((f) => f.name === value) ? getDisplayName(options.find((f) => f.name === value)!) : value;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cartFieldSelectTriggerClass}
      >
        <span className="truncate">{selectedLabel || "Select frequency"}</span>
        <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-44 overflow-hidden">
          <div className="p-2 border-b border-gray-200 dark:border-gray-600">
            <input
              type="text"
              placeholder="Filter frequency..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cartFieldDropdownFilterClass}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="max-h-36 overflow-y-auto">
            {filtered.length > 0 ? filtered.map((freq) => {
              const displayName = getDisplayName(freq);
              return (
                <button
                  key={freq.name}
                  type="button"
                  onClick={() => handleSelect(freq.name)}
                  className={`${cartFieldDropdownItemClass} ${value === freq.name ? 'bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400' : 'text-gray-900 dark:text-white'}`}
                >
                  {displayName}
                </button>
              );
            }) : (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

type PharmacyVisitRef = {
  doctype: string;
  name: string;
  visit_type?: string | null;
  visit_date?: string | null;
};

function toDateOnly(value?: string | number | null): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const iso = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}

function todayISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDispenseDateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString();
}

function visitDateFromRecord(record?: Record<string, unknown> | PharmacyVisitRef | null): string {
  if (!record) return "";
  const row = record as Record<string, unknown>;
  return (
    toDateOnly(row.visit_date as string) ||
    toDateOnly(row.encounter_date as string) ||
    toDateOnly(row.posting_date as string) ||
    ""
  );
}

function getSelectedPartyDisplayName(
  selectedPatient: Patient | null | undefined,
  selectedCustomer: Customer | null | undefined
): string {
  if (selectedPatient) {
    return getPatientDisplayName(selectedPatient);
  }
  if (selectedCustomer) {
    return selectedCustomer.customer_name || selectedCustomer.name;
  }
  return "";
}

function customerFromResolvedRow(row: ResolvedCustomer): Customer {
  return {
    id: row.name,
    type: row.customer_type === "Company" ? "company" : "individual",
    name: row.customer_name || row.name,
    customer_name: row.customer_name || row.name,
    email: "",
    phone: "",
    address: {
      street: "",
      city: "",
      state: "",
      zipCode: "",
      country: "",
    },
    loyaltyPoints: 0,
    totalSpent: 0,
    totalOrders: 0,
    preferredPaymentMethod: "Cash",
    notes: "",
    tags: [],
    status: "active",
    createdAt: new Date().toISOString(),
    defaultCurrency: row.default_currency,
  };
}

function PatientSearchDropdownOption({ patient }: { patient: Patient }) {
  const displayName = getPatientDisplayName(patient);
  const secondaryLabel = getPatientSecondaryLabel(patient);

  return (
    <div className="flex items-center space-x-2">
      <User className="w-4 h-4 text-blue-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
          {displayName}
        </div>
        {secondaryLabel ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {secondaryLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function OrderSummary({
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  appliedCoupons,
  // onApplyCoupon,
  onRemoveCoupon,
  isMobile = false,
}: OrderSummaryProps) {
  // const [showCouponPopover, setShowCouponPopover] = useState(false);
  const {
    selectedCustomer,
    setSelectedCustomer,
    selectedPatient,
    setSelectedPatient,
    redeemLoyaltyPoints,
    setRedeemLoyaltyPoints,
    updateUOM,
    updatePricesForCustomer,
    addToCartWithQuantity,
    addToCart,
    updateItemMetadata,
    generalAdditionalAmount,
    additionalRemark,
    setGeneralAdditionalAmount,
    setAdditionalRemark,
  } = useCartStore();

  // Track if user has manually removed the default customer
  const [userRemovedDefaultCustomer, setUserRemovedDefaultCustomer] = useState(false);

  // Debug selectedCustomer changes
  // useEffect(() => {
  //   console.log();
  // }, [selectedCustomer]);

  // Track if this is the initial load to prevent price recalculation on page refresh
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    // Mark initial load as complete after a short delay
    const timer = setTimeout(() => {
      setIsInitialLoad(false);
    }, 2000); // 2 seconds should be enough for cart to restore from localStorage

    return () => clearTimeout(timer);
  }, []);

  // Update prices only when customer changes (not on every cart length mutation),
  // to avoid duplicate async pricing runs racing each other.
  useEffect(() => {
    if (!isInitialLoad && selectedCustomer) {
      updatePricesForCustomer(selectedCustomer.id);
    }
  }, [selectedCustomer?.id, isInitialLoad, updatePricesForCustomer]);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerSearchContainerRef = useRef<HTMLDivElement>(null);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showMedicationOrdersModal, setShowMedicationOrdersModal] = useState(false);
  const [showPatientDetailsModal, setShowPatientDetailsModal] = useState(false);
  const [loadingPatientHistory, setLoadingPatientHistory] = useState(false);
  const [patientHistorySummary, setPatientHistorySummary] = useState<PatientHistorySummary | null>(null);
  const [showRedeemLoyaltyModal, setShowRedeemLoyaltyModal] = useState(false);
  const [showAdditionalAmountModal, setShowAdditionalAmountModal] = useState(false);
  const [showPharmacyServiceModal, setShowPharmacyServiceModal] = useState(false);
  const [pharmacyServiceParent, setPharmacyServiceParent] = useState<{
    lineKey: string;
    itemName: string;
  } | null>(null);
  const [redeemPointsInput, setRedeemPointsInput] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [medicationOrders, setMedicationOrders] = useState<InpatientMedicationOrder[]>([]);
  const [medicationOrderHistory, setMedicationOrderHistory] = useState<InpatientMedicationOrder[]>([]);
  const [legacyDispensedMedications, setLegacyDispensedMedications] = useState<LegacyDispensedTransaction[]>([]);
  const [subscriptionMedicationPlans, setSubscriptionMedicationPlans] = useState<SubscriptionMedicationPlan[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [selectedHistoryItems, setSelectedHistoryItems] = useState<Set<string>>(new Set());
  const [selectedLegacyItems, setSelectedLegacyItems] = useState<Set<string>>(new Set());
  const [selectedSubscriptionItems, setSelectedSubscriptionItems] = useState<Set<string>>(new Set());
  const [isCreatingVisit, setIsCreatingVisit] = useState(false);
  const [createdVisitRef, setCreatedVisitRef] = useState<PharmacyVisitRef | null>(null);
  const [patientVisitCreatedSignal, setPatientVisitCreatedSignal] = useState(0);
  const [isDispensing, setIsDispensing] = useState(false);
  const [showClinicalAppropriatenessConfirm, setShowClinicalAppropriatenessConfirm] = useState(false);
  const [dispenseRemarks, setDispenseRemarks] = useState("");
  const [dispenseRecordDate, setDispenseRecordDate] = useState<string | null>(null);
  const [showDispenseDateModal, setShowDispenseDateModal] = useState(false);
  const [dispenseDateDraft, setDispenseDateDraft] = useState(todayISODate);
  const [isResolvingVisitDate, setIsResolvingVisitDate] = useState(false);

  useEffect(() => {
    const closeTransientUi = () => {
      setShowCustomerDropdown(false);
      setShowPaymentDialog(false);
      setShowMedicationOrdersModal(false);
      setShowPatientDetailsModal(false);
      setShowRedeemLoyaltyModal(false);
      setShowAdditionalAmountModal(false);
      setShowPharmacyServiceModal(false);
      setShowAddCustomerModal(false);
      setShowClinicalAppropriatenessConfirm(false);
      setShowDispenseDateModal(false);
    };

    window.addEventListener(POS_BEFORE_NAVIGATE_EVENT, closeTransientUi);
    return () => window.removeEventListener(POS_BEFORE_NAVIGATE_EVENT, closeTransientUi);
  }, []);
  const [lastDispensedSalesOrder, setLastDispensedSalesOrder] = useState<string | null>(null);
  const [lastDispensedLabelItems, setLastDispensedLabelItems] = useState<DispensedLabelItem[]>([]);
  const [lastDispensedCartSignature, setLastDispensedCartSignature] = useState<string | null>(null);
  // Outpatient (Rose) pharmacies dispense through the payment flow (not a hospital sales order),
  // so they get their own "Print Labels" affordance after a completed sale (PK-11).
  const [showOpDispenseLabels, setShowOpDispenseLabels] = useState(false);
  // const couponButtonRef = useRef<HTMLButtonElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { posDetails, loading: _posLoading } = usePOSDetails();
  const isPharmacy = posDetails?.custom_is_pharmacy === 1 ||
                     posDetails?.custom_is_pharmacy === true ||
                     posDetails?.custom_is_pharmacy === "1";
  const isHospitalPharmacy = posDetails?.custom_is_hospital_pharmacy === 1 ||
                             posDetails?.custom_is_hospital_pharmacy === true ||
                             posDetails?.custom_is_hospital_pharmacy === "1";
  const allowUserEditRate =
    !isHospitalPharmacy &&
    (posDetails?.allow_rate_change === 1 ||
      posDetails?.allow_rate_change === true ||
      posDetails?.allow_rate_change === "1");
  const { customers, isLoading, refetch: refetchCustomers } = useCustomers(
    isHospitalPharmacy ? "" : customerSearchQuery
  );

  const party = getPartyLabels(isHospitalPharmacy);

  // Restore patient display after page refresh (customer is persisted; patient must be re-linked).
  useEffect(() => {
    if (!isHospitalPharmacy) return;

    if (selectedPatient) {
      setCustomerSearchQuery(getPatientDisplayName(selectedPatient));
      return;
    }

    if (!selectedCustomer?.id) return;

    let cancelled = false;
    void resolvePatientForCustomer(selectedCustomer.id).then((patient) => {
      if (cancelled || !patient) return;
      setSelectedPatient(patient);
      setCustomerSearchQuery(getPatientDisplayName(patient));
    });

    return () => {
      cancelled = true;
    };
  }, [isHospitalPharmacy, selectedCustomer?.id, selectedPatient, setSelectedPatient]);

  const loadPatientHistorySummary = useCallback(async (patientId: string) => {
    if (!patientId?.trim()) {
      setPatientHistorySummary(null);
      return;
    }
    setLoadingPatientHistory(true);
    try {
      const summary = await getPatientHistorySummary(patientId, 10);
      setPatientHistorySummary(summary);
    } catch (error) {
      console.error("Failed to load patient history summary:", error);
      setPatientHistorySummary(null);
    } finally {
      setLoadingPatientHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!isHospitalPharmacy || !selectedPatient?.name) {
      setPatientHistorySummary(null);
      return;
    }
    void loadPatientHistorySummary(selectedPatient.name);
  }, [isHospitalPharmacy, selectedPatient?.name, loadPatientHistorySummary]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { products, refetch: _refetchProducts, refreshStockOnly, updateStockForItems: _updateStockForItems, updateBatchQuantitiesForItems, updateSerialsForItems, updateDispensingLotsForItems } = useProducts();
  const setAfterPosSaleComplete = useUiStore((state) => state.setAfterPosSaleComplete);
  const { checkCustomerPermission } = useCustomerPermission();

  const pharmacyDefaultUom =
    typeof posDetails?.custom_pharmacy_default_uom === "string"
      ? posDetails.custom_pharmacy_default_uom.trim()
      : "";

  const isItemTaxTemplateMode = posDetails?.custom_allow_item_tax_template === 1 ||
    posDetails?.custom_allow_item_tax_template === true ||
    posDetails?.custom_allow_item_tax_template === "1";

  const isAllowAdditionalAmounts = posDetails?.custom_allow_additional_amounts === 1 ||
    posDetails?.custom_allow_additional_amounts === true ||
    posDetails?.custom_allow_additional_amounts === "1";

  const useDispenseLot =
    posDetails?.custom_dispense_lot === 1 ||
    posDetails?.custom_dispense_lot === true ||
    posDetails?.custom_dispense_lot === "1";

  const handleAddDuplicateLine = useCallback(
    async (item: CartItem) => {
      const product = products.find((p) => p.id === item.id);
      const has_serial_no =
        (item as CartItem).has_serial_no ?? product?.has_serial_no;
      const has_batch_no =
        (item as CartItem).has_batch_no ?? product?.has_batch_no;
      let uomToUse = item.uom;
      let conversion_factor = item.conversion_factor || 1;
      let stock_uom = item.stock_uom || product?.stock_uom || product?.uom;
      if (isHospitalPharmacy && item.id) {
        const resolved = await resolveHospitalCartUomDetails(
          item.id,
          item.uom || product?.uom
        );
        uomToUse = resolved.uom;
        conversion_factor = resolved.conversion_factor;
        stock_uom = resolved.stock_uom;
      }
      await addToCart({
        id: item.id,
        name: item.name,
        category: item.category,
        price: item.price,
        image: item.image,
        available: item.available,
        uom: uomToUse,
        stock_uom,
        conversion_factor,
        item_code: item.item_code || item.id,
        item_tax_template: (item as CartItem & { item_tax_template?: string })
          .item_tax_template,
        has_serial_no,
        has_batch_no,
        allowDuplicate: true,
      });
    },
    [addToCart, products, isHospitalPharmacy]
  );

  const getSoldLineItems = useCallback(() => {
    return cartItems
      .map((item) => ({
        itemCode: item.item_code || item.id,
        batchNo: (item as CartItem & { batch_no?: string }).batch_no,
      }))
      .filter((row) => row.itemCode && row.itemCode !== "undefined");
  }, [cartItems]);

  const refreshSoldItemPickers = useCallback(
    async (soldItems: Array<{ itemCode: string; batchNo?: string }>) => {
      const itemCodes = [...new Set(soldItems.map((row) => row.itemCode))];
      if (itemCodes.length === 0) return;

      await updateBatchQuantitiesForItems(itemCodes);
      await updateSerialsForItems(itemCodes);
      if (useDispenseLot) {
        await updateDispensingLotsForItems(soldItems);
      }
    },
    [
      updateBatchQuantitiesForItems,
      updateSerialsForItems,
      updateDispensingLotsForItems,
      useDispenseLot,
    ]
  );

  const refreshDispensingLotsForItem = useCallback(
    async (itemCode: string, batchNo?: string) => {
      if (!useDispenseLot || !itemCode) return;
      await updateDispensingLotsForItems([{ itemCode, batchNo }]);
    },
    [useDispenseLot, updateDispensingLotsForItems]
  );

  const { templates: itemTaxTemplates } = useItemTaxTemplates();
  const itemTaxTemplateNames = cartItems
    .map((item) => (item as { item_tax_template?: string }).item_tax_template)
    .filter(Boolean) as string[];
  const { rates: itemTaxTemplateRates } = useItemTaxTemplateRates(itemTaxTemplateNames);
  const freeItemTaxAmount = useFreeItemTaxAmount(cartItems, isItemTaxTemplateMode);

  /** Convert quantity from order UOM to cart UOM using Item UOM conversion factors. If no conversion, assume 1:1. */
  const convertOrderQuantityToCartUOM = useCallback(
    async (itemCode: string, orderQuantity: number, orderUom: string | undefined, cartUom: string): Promise<number> => {
      if (!orderUom || orderUom === cartUom) return orderQuantity;
      try {
        const { base_uom, uoms } = await getItemUOMsAndPrices(itemCode);
        const orderFactor = orderUom === base_uom ? 1 : (uoms.find((u) => u.uom === orderUom)?.conversion_factor ?? 1);
        const cartFactor = cartUom === base_uom ? 1 : (uoms.find((u) => u.uom === cartUom)?.conversion_factor ?? 1);
        if (cartFactor === 0) return orderQuantity;
        return (orderQuantity * orderFactor) / cartFactor;
      } catch {
        return orderQuantity;
      }
    },
    []
  );

  // Search for patients when pharmacy or hospital pharmacy mode is enabled
  useEffect(() => {
    if ((isPharmacy || isHospitalPharmacy) && customerSearchQuery.trim().length >= 2) {
      let cancelled = false;
      const searchPatientsDebounced = setTimeout(() => {
        searchPatients(customerSearchQuery.trim())
          .then((results) => {
            if (!cancelled) setPatients(results);
          })
          .catch((error) => {
            if (!cancelled) {
              console.error("Error searching patients:", error);
              setPatients([]);
            }
          });
      }, 300);

      return () => {
        cancelled = true;
        clearTimeout(searchPatientsDebounced);
      };
    }

    setPatients([]);
  }, [customerSearchQuery, isPharmacy, isHospitalPharmacy]);

  // Close patient/customer dropdown when clicking outside (without selecting)
  useEffect(() => {
    if (!showCustomerDropdown) return;

    const handlePointerDownOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (customerSearchContainerRef.current?.contains(target)) return;
      setShowCustomerDropdown(false);
    };

    document.addEventListener("mousedown", handlePointerDownOutside);
    document.addEventListener("touchstart", handlePointerDownOutside);
    return () => {
      document.removeEventListener("mousedown", handlePointerDownOutside);
      document.removeEventListener("touchstart", handlePointerDownOutside);
    };
  }, [showCustomerDropdown]);
  
  // State for prescription frequencies (from Prescription Frequency doctype)
  const [prescriptionFrequencies, setPrescriptionFrequencies] = useState<PrescriptionFrequency[]>([]);

  useEffect(() => {
    if (!isPharmacy && !isHospitalPharmacy) {
      setPrescriptionFrequencies([]);
      return;
    }

    let cancelled = false;
    getPrescriptionFrequencies()
      .then((frequencies) => {
        if (!cancelled) setPrescriptionFrequencies(frequencies);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Error loading prescription frequencies:", error);
          setPrescriptionFrequencies([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isPharmacy, isHospitalPharmacy]);

  // Get customer statistics for the selected customer
  const { statistics: customerStats } = useCustomerStatistics(selectedCustomer?.id || null);
  const [prefilledCustomerName, setPrefilledCustomerName] = useState("");
  const [prefilledData, setPrefilledData] = useState<{
    name?: string;
    email?: string;
    phone?: string;
  }>({});

  // const currency = posDetails?.currency;
  const currency_symbol = posDetails?.currency_symbol;

  // UOM change handler
  const handleUOMChange = useCallback((itemId: string, selectedUOM: string, newPrice: number, conversionFactor: number) => {
    // console.log(`🛒 Cart Update Started:`);
    // console.log(`  Item ID: ${itemId}`);
    // console.log(`  New UOM: ${selectedUOM}`);
    // console.log(`  New Price: $${newPrice}`);

    // Find the current item before update
    const currentItem = cartItems.find(item => item.id === itemId);
    if (currentItem) {
      console.log(`  Before Update:`, {
        name: currentItem.name,
        uom: currentItem.uom,
        price: currentItem.price,
        quantity: currentItem.quantity
      });
    }

    // Update the cart item with new UOM and price using the cart store
    updateUOM(itemId, selectedUOM, newPrice, conversionFactor);

    // Debug: Check if the cart item was updated
    setTimeout(() => {
      // const updatedItem = cartItems.find(item => item.id === itemId);
      // Cart update completed
    }, 100);
  }, [updateUOM, cartItems]);
  // State for item-level discounts and details
  const [itemDiscounts, setItemDiscounts] = useState<
    Record<
      string,
      {
        discountPercentage: number;
        discountAmount: number;
        batchNumber: string;
        serialNumber: string;
        dispensingLot?: string;
        availableQuantity: number;
        prescriptionDosage?: string; // From Prescription Frequency doctype (dropdown)
        dosage?: string; // Free text dosage copied from patient medication order
        medicationOrder?: string; // Patient Medication Order (when items added from order)
      }
    >
  >({});

  const [itemBatches, setItemBatches] = useState<
    Record<string, { batch_id: string; qty: number; expiry_date?: string | null }[]>
  >({});

  const [batchExpiryLookup, setBatchExpiryLookup] = useState<Record<string, string>>({});

  const [itemSerials, setItemSerials] = useState<
    Record<string, string[]>
  >({});

  const [itemDispensingLots, setItemDispensingLots] = useState<
    Record<string, DispensingLotOption[]>
  >({});

  const [serialLotMaps, setSerialLotMaps] = useState<
    Record<string, Record<string, string>>
  >({});

  // Pending pre-selections when item not yet in cart
  const [pendingPreselect, setPendingPreselect] = useState<
    Record<string, { batchId?: string; serialNo?: string }>
  >({});

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Ref so batch/serial handlers always merge with latest discounts (avoids losing other lines when state is stale)
  const itemDiscountsRef = useRef(itemDiscounts);
  const serialLotMapsRef = useRef(serialLotMaps);
  const itemDispensingLotsRef = useRef(itemDispensingLots);
  const cartItemsRef = useRef(cartItems);
  useEffect(() => {
    itemDiscountsRef.current = itemDiscounts;
  }, [itemDiscounts]);
  useEffect(() => {
    serialLotMapsRef.current = serialLotMaps;
  }, [serialLotMaps]);
  useEffect(() => {
    itemDispensingLotsRef.current = itemDispensingLots;
  }, [itemDispensingLots]);
  useEffect(() => {
    cartItemsRef.current = cartItems;
  }, [cartItems]);

  const draftRestoreKeyRef = useRef<string | null>(null);
  const heldRestoreKeyRef = useRef<string | null>(null);

  const productAvailability = useCallback(() => {
    const map: Record<string, number> = {};
    products.forEach((p) => {
      map[p.id] = p.available;
      if (p.item_code) map[p.item_code] = p.available;
    });
    return map;
  }, [products]);

  // Per-line key for batch/serial/discount (same item can appear in multiple lines when allow duplicate)
  const getLineKey = (i: CartItem) => (i as CartItem & { cartLineId?: string }).cartLineId || i.id;

  const resolveBatchExpiry = useCallback(
    (itemCode: string, batchId?: string) => {
      if (!batchId?.trim()) return null;
      const fromLookup = batchExpiryLookup[batchId];
      if (fromLookup) return fromLookup;
      const fromOptions = itemBatches[itemCode]?.find((b) => b.batch_id === batchId)?.expiry_date;
      return fromOptions || null;
    },
    [batchExpiryLookup, itemBatches]
  );

  const rememberBatchExpiry = useCallback((batchId: string, expiry?: string | null) => {
    if (!batchId?.trim() || !expiry?.trim()) return;
    setBatchExpiryLookup((prev) =>
      prev[batchId] === expiry ? prev : { ...prev, [batchId]: expiry }
    );
  }, []);

  const fetchBatchExpiryIfNeeded = useCallback(
    async (batchId: string, itemCode: string, itemName?: string) => {
      if (!batchId?.trim()) return;
      let expiry = resolveBatchExpiry(itemCode, batchId);
      if (!expiry) {
        try {
          const details = await getBatchLabelDetails([batchId]);
          expiry = details[batchId]?.expiry_date || null;
          if (expiry) rememberBatchExpiry(batchId, expiry);
        } catch (error) {
          console.error("Failed to fetch batch expiry:", error);
          return;
        }
      }
      warnOnBatchExpirySelection(itemName || itemCode, batchId, expiry);
    },
    [rememberBatchExpiry, resolveBatchExpiry]
  );

  const collectCartBatchExpiryLines = useCallback(() => {
    return cartItems
      .filter((item) => !(item as CartItem & { is_pharmacy_service?: boolean }).is_pharmacy_service)
      .map((item) => {
        const lineKey = getLineKey(item);
        const itemCode = item.item_code || item.id;
        const batchId =
          itemDiscounts[lineKey]?.batchNumber ||
          (item as CartItem & { batch_no?: string }).batch_no ||
          "";
        return {
          itemName: item.name || itemCode,
          itemCode,
          batchId,
          expiryHint: resolveBatchExpiry(itemCode, batchId),
        };
      });
  }, [cartItems, itemDiscounts, resolveBatchExpiry]);

  /** Block expired batches; confirm before continuing if any are near expiry. */
  const confirmCartBatchExpiry = useCallback(async (): Promise<boolean> => {
    try {
      const { expired, nearExpiry } = await auditCartBatchExpiry(collectCartBatchExpiryLines());
      if (expired.length > 0) {
        toast.error(
          `Cannot dispense expired stock:\n${expired.map((l) => `• ${formatBatchExpiryMessage(l)}`).join("\n")}`
        );
        return false;
      }
      if (nearExpiry.length > 0) {
        const details = nearExpiry.map((l) => `• ${formatBatchExpiryMessage(l)}`).join("\n");
        return window.confirm(
          `Near-expiry medicine in cart (within 90 days):\n${details}\n\nContinue anyway?`
        );
      }
      return true;
    } catch (error) {
      console.error("Batch expiry check failed:", error);
      // Fail open only for lookup errors; backend still blocks expired on submit.
      return true;
    }
  }, [collectCartBatchExpiryLines]);

  useEffect(() => {
    const cached = getCachedDraftInvoiceItems();
    if (!cached?.lineDiscounts || !cartItems.length) return;
    if (draftRestoreKeyRef.current === cached.invoiceId) return;

    const lineDiscounts = cached.lineDiscounts;
    const restoreDraftLines = async () => {
      setItemDiscounts((prev) => ({ ...prev, ...lineDiscounts }));

      const serialUpdates: Record<string, string> = {};
      const newDispensingLots: Record<string, DispensingLotOption[]> = {};
      const newLotMaps: Record<string, Record<string, string>> = {};

      for (const item of cartItems) {
        const lineKey = getLineKey(item);
        const cachedLine = lineDiscounts[lineKey];
        if (!cachedLine) continue;

        const itemCode = item.item_code || item.id;
        const batchNo = cachedLine.batchNumber || (item as CartItem & { batch_no?: string }).batch_no || "";
        const cacheKey = getDispensingLotCacheKey(itemCode, batchNo);

        if (cachedLine.batchNumber) {
          updateItemMetadata(lineKey, { batch_no: cachedLine.batchNumber });
        }

        const serialFromCache = cachedLine.serialNumber?.trim();
        const lotText = cachedLine.dispensingLot?.trim();

        if (useDispenseLot && lotText) {
          let lots = newDispensingLots[cacheKey];
          if (!lots?.length) {
            try {
              lots = await getDispensingLots(itemCode, batchNo || undefined);
              newDispensingLots[cacheKey] = lots;
              newLotMaps[cacheKey] = buildSerialLotMap(lots);
            } catch (err) {
              console.error("Error restoring dispensing lots for draft:", err);
            }
          }
          const serialCsv =
            serialFromCache ||
            resolveSerialNumbersFromLotNames(lots || [], lotText);
          if (serialCsv) {
            serialUpdates[lineKey] = serialCsv;
            updateItemMetadata(lineKey, {
              serial_no: serialCsv,
              dispensing_lot: lotText,
            });
          }
        } else if (serialFromCache) {
          serialUpdates[lineKey] = serialFromCache;
          updateItemMetadata(lineKey, { serial_no: serialFromCache });
        }
      }

      if (Object.keys(serialUpdates).length > 0) {
        setItemDiscounts((prev) => {
          const next = { ...prev, ...lineDiscounts };
          for (const [lineKey, serialNumber] of Object.entries(serialUpdates)) {
            next[lineKey] = {
              ...(next[lineKey] || lineDiscounts[lineKey] || {
                discountPercentage: 0,
                discountAmount: 0,
                batchNumber: "",
                serialNumber: "",
                availableQuantity: 0,
              }),
              serialNumber,
            };
          }
          return next;
        });
      }

      if (Object.keys(newDispensingLots).length > 0) {
        setItemDispensingLots((prev) => ({ ...prev, ...newDispensingLots }));
      }
      if (Object.keys(newLotMaps).length > 0) {
        setSerialLotMaps((prev) => ({ ...prev, ...newLotMaps }));
      }

      draftRestoreKeyRef.current = cached.invoiceId;
    };

    void restoreDraftLines();
  }, [cartItems, useDispenseLot, updateItemMetadata]);

  useEffect(() => {
    const cached = getCachedHeldDispenseOrder();
    if (!cached?.lineDiscounts || !cartItems.length) return;
    if (heldRestoreKeyRef.current === cached.salesOrderId) return;

    setItemDiscounts((prev) => ({ ...prev, ...cached.lineDiscounts! }));
    if (cached.dispenseRemarks) {
      setDispenseRemarks(cached.dispenseRemarks);
    }
    if (cached.createdVisitRef) {
      setCreatedVisitRef(cached.createdVisitRef);
    }
    if (cached.dispenseDate) {
      setDispenseRecordDate(toDateOnly(cached.dispenseDate) || null);
    }
    heldRestoreKeyRef.current = cached.salesOrderId;
  }, [cartItems.length]);

  const getLineBatchNo = useCallback(
    (item: CartItem, lineKey?: string) => {
      const key = lineKey || getLineKey(item);
      const discount = itemDiscounts[key];
      return (
        discount?.batchNumber?.trim() ||
        (item as CartItem & { batch_no?: string }).batch_no?.trim() ||
        ""
      );
    },
    [itemDiscounts, getLineKey]
  );

  const cartFetchSignature = useMemo(
    () =>
      cartItems
        .map((item) => `${getLineKey(item)}:${item.item_code || item.id}`)
        .join("|"),
    [cartItems, getLineKey]
  );

  const dispensingLotSignature = useMemo(
    () =>
      cartItems
        .map((item) => {
          const lineKey = getLineKey(item);
          return `${lineKey}:${getLineBatchNo(item, lineKey)}`;
        })
        .join("|"),
    [cartItems, getLineKey, getLineBatchNo]
  );

  const getLotsForLine = useCallback(
    (item: CartItem) => {
      const itemCode = item.item_code || item.id;
      const batchNo = getLineBatchNo(item);
      const cacheKey = getDispensingLotCacheKey(itemCode, batchNo);
      if (itemDispensingLots[cacheKey]) {
        return itemDispensingLots[cacheKey];
      }
      return filterLotsByBatch(itemDispensingLots[itemCode] || [], batchNo);
    },
    [getLineBatchNo, itemDispensingLots]
  );

  const getSerialSelectOptions = useCallback(
    (item: CartItem) => {
      const itemCode = item.item_code || item.id;
      const stockUom = item.stock_uom || item.base_uom;
      const showRemaining =
        !!useDispenseLot && !!item.uom && !!stockUom && item.uom !== stockUom;

      if (useDispenseLot) {
        const lots = getLotsForLine(item);
        return lots.map((lot) => ({
          value: lot.serial_no,
          label: formatDispensingLotLabel(lot, showRemaining),
        }));
      }
      return (itemSerials[itemCode] || []).map((s) => ({ value: s, label: s }));
    },
    [useDispenseLot, getLotsForLine, itemSerials]
  );

  const syncDispensingLotMetadata = useCallback(
    (lineKey: string, itemCode: string, serialCsv: string) => {
      if (!useDispenseLot) return;
      const batchNo = itemDiscounts[lineKey]?.batchNumber || "";
      const mapKey = getDispensingLotCacheKey(itemCode, batchNo);
      const map =
        serialLotMaps[mapKey] || serialLotMaps[itemCode] || {};
      const serials = serialCsv.split(",").map((s) => s.trim()).filter(Boolean);
      const lotNames = Array.from(
        new Set(serials.map((s) => map[s]).filter(Boolean))
      );
      const lotsValue = joinDispensingLotNames(lotNames);
      updateItemMetadata(lineKey, {
        dispensing_lot: lotsValue || undefined,
      });
      if (lotsValue) {
        setItemDiscounts((prev) => ({
          ...prev,
          [lineKey]: {
            ...(prev[lineKey] || {
              discountPercentage: 0,
              discountAmount: 0,
              batchNumber: "",
              serialNumber: "",
              availableQuantity: 0,
            }),
            dispensingLot: lotsValue,
          },
        }));
      }
    },
    [useDispenseLot, serialLotMaps, itemDiscounts, updateItemMetadata]
  );

  // Helper function to calculate item price after discount
  const getDiscountedPrice = (item: CartItem) => {
    const itemDiscount = itemDiscounts[getLineKey(item)] || {
      discountPercentage: 0,
      discountAmount: 0,
    };
    let discountedPrice = item.price;

    // Apply percentage discount first
    if (itemDiscount.discountPercentage > 0) {
      discountedPrice =
        item.price * (1 - itemDiscount.discountPercentage / 100);
    }

    // Then apply fixed amount discount
    if (itemDiscount.discountAmount > 0) {
      discountedPrice = Math.max(
        0,
        discountedPrice - itemDiscount.discountAmount
      );
    }

    return Math.max(0, discountedPrice);
  };

  // Calculate subtotal with item-level discounts (additional amounts are shown separately)
  const subtotal = cartItems.reduce((sum, item) => {
    const discountedPrice = getDiscountedPrice(item);
    return sum + discountedPrice * item.quantity;
  }, 0);

  // Calculate total discount amount for display
  const totalItemDiscount = cartItems.reduce((sum, item) => {
    const originalAmount = item.price * item.quantity;
    const discountedAmount = getDiscountedPrice(item) * item.quantity;
    return sum + (originalAmount - discountedAmount);
  }, 0);

  // Calculate coupon discount
  const couponDiscount = appliedCoupons.reduce(
    (sum, coupon) => sum + coupon.value,
    0
  );

  // Calculate final total (items - coupons). Additional amounts are handled in PaymentDialog.
  const taxableAmount = Math.max(0, subtotal - couponDiscount);
  let itemTemplateTaxAmount = 0;
  if (isItemTaxTemplateMode) {
    cartItems.forEach((item) => {
      const itemTotal = getDiscountedPrice(item) * item.quantity;
      const template = (item as { item_tax_template?: string }).item_tax_template;
      const rate = template ? (itemTaxTemplateRates[template] ?? 0) : 0;
      itemTemplateTaxAmount += (itemTotal * rate) / 100;
    });
    itemTemplateTaxAmount += freeItemTaxAmount || 0;
  }
  const total = isItemTaxTemplateMode
    ? Math.max(0, taxableAmount + itemTemplateTaxAmount)
    : taxableAmount;
  const handleCustomerSearchKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Escape") {
      setShowCustomerDropdown(false);
      return;
    }
    if (e.key === "Enter" && customerSearchQuery.trim() !== "") {
      if (isHospitalPharmacy && visiblePatients.length === 1 && visiblePatients[0]) {
        void handlePatientSelect(visiblePatients[0]);
        return;
      }

      // Check if there are no matching customers
      if (filteredCustomers.length === 0 && !(isHospitalPharmacy && visiblePatients.length > 0)) {
        // This is a new customer - detect input type and set prefilled data
        const trimmedValue = customerSearchQuery.trim();
        let prefilledData = {};

        // Check if it's an email
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue)) {
          prefilledData = { email: trimmedValue };
        }
        // Check if it's a phone number (contains mostly digits with some special characters)
        else if (
          /^[\d\s+()-]+$/.test(trimmedValue) &&
          trimmedValue.replace(/[\s+()-]/g, "").length >= 7
        ) {
          // Format phone number with Saudi Arabia country code if it doesn't already have one
          let formattedPhone = trimmedValue;
          const cleanNumber = trimmedValue.replace(/[\s+()-]/g, "");

          // If the number doesn't start with +966 (Saudi Arabia code), add it
          if (
            !cleanNumber.startsWith("966") &&
            !cleanNumber.startsWith("+966")
          ) {
            // If it starts with 0, replace with +966
            if (cleanNumber.startsWith("0")) {
              formattedPhone = "+966" + cleanNumber.substring(1);
            } else {
              // Otherwise just add +966
              formattedPhone = "+966" + cleanNumber;
            }
          } else if (
            cleanNumber.startsWith("966") &&
            !cleanNumber.startsWith("+966")
          ) {
            // If it starts with 966 but no +, add the +
            formattedPhone = "+" + cleanNumber;
          }


          prefilledData = { phone: formattedPhone };
        }
        // Otherwise treat as name
        else {
          console.log("Detected name:", trimmedValue);
          prefilledData = { name: trimmedValue };
        }

        // Set the prefilled data and open the modal
        setPrefilledData(prefilledData);
        setPrefilledCustomerName(trimmedValue);
        setShowAddCustomerModal(true);
        setShowCustomerDropdown(false);
      } else if (
        !isHospitalPharmacy &&
        filteredCustomers.length === 1 &&
        !userRemovedDefaultCustomer &&
        filteredCustomers[0]
      ) {
        handleCustomerSelect(filteredCustomers[0]);
      }
    }
  };

  // Function to update item discount
  const updateItemDiscount = (
    itemId: string,
    field: string,
    value: number | string | null
  ) => {
    setItemDiscounts((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {
          discountPercentage: 0,
          discountAmount: 0,
          batchNumber: "",
          serialNumber: "",
          availableQuantity: 150,
        }),
        [field]:
          value === null
            ? null
            : typeof value === "string"
              ? value
              : Math.max(0, value),
      },
    }));
  };

  type MedicationOrderLineInput = {
    item_code: string;
    quantity: number;
    uom?: string;
    dosage?: string;
    patient_frequency?: string;
    drug_name?: string;
    medication_order?: string;
    medication_order_entry?: string;
    is_pink?: number | boolean | string;
    reference_no?: string;
    alternative_item_code?: string;
    line_key?: string;
  };

  const isPinkMedicationLine = (item: MedicationOrderLineInput) =>
    item.is_pink === 1 || item.is_pink === true || item.is_pink === "1";

  const addMedicationOrderLineToCart = useCallback(
    async (
      itemToAdd: MedicationOrderLineInput,
      qtyByItem: Map<string, number>,
      medsByItem: Map<string, Set<string>>,
      extraOrderNames: string[] = []
    ): Promise<"added" | "not_found" | "no_stock"> => {
      const effectiveItemCode = itemToAdd.alternative_item_code || itemToAdd.item_code;
      const isAlternative =
        !!itemToAdd.alternative_item_code &&
        itemToAdd.alternative_item_code !== itemToAdd.item_code;
      const product = products.find(
        (p) => p.id === effectiveItemCode || p.item_code === effectiveItemCode
      );
      if (!product) {
        console.warn(`Product not found for item_code: ${effectiveItemCode}`);
        return "not_found";
      }
      if (product.available <= 0) {
        return "no_stock";
      }

      const pink = isPinkMedicationLine(itemToAdd);
      const dispenseUoms = await getItemUOMsAndPrices(product.id);
      const stockUom = dispenseUoms.base_uom || product.uom;

      // Doctor UOM: only PACK stays PACK; UNIT/Milligram/Tablet/etc. → treat as UNIT for cart.
      const orderUomForCart = resolveMedicationOrderUom(itemToAdd.uom);
      const unitNameOnItem =
        dispenseUoms.uoms.find((row) => normalizeUom(row.uom) === "UNIT")?.uom?.trim() || "UNIT";

      let uomToUse: string;
      if (orderUomForCart === "PACK") {
        uomToUse =
          dispenseUoms.uoms.find((row) => normalizeUom(row.uom) === "PACK")?.uom?.trim() ||
          stockUom ||
          "PACK";
      } else if (isHospitalPharmacy) {
        const resolved = await resolveHospitalCartUomDetails(product.id, unitNameOnItem);
        uomToUse = resolved.uom;
      } else {
        uomToUse = unitNameOnItem;
      }

      // Always keep prescribed numeric qty (30 Milligram → 30 UNIT on cart).
      const cartQuantity = itemToAdd.quantity;

      // Validate stock using the *dispensed* item's conversion for the cart UOM (UNIT/PACK),
      // never the doctor's free-text UOM (Milligram has no Item UOM factor).
      // product.available is always in stock UOM (PACK), not cart UOM.
      const conversionFactor = getUomConversionFactor(
        dispenseUoms.uoms,
        dispenseUoms.base_uom,
        uomToUse
      );
      const neededStockQty = cartQuantity * conversionFactor;

      if (neededStockQty > product.available) {
        toast.error(
          `Only ${product.available} ${stockUom || "PACK"} of ${product.name} available (need ${cartQuantity} ${uomToUse || "UNIT"} = ${neededStockQty} ${stockUom || "PACK"} for this prescription)`
        );
        return "no_stock";
      }
      const prescriptionDosageValue = itemToAdd.patient_frequency;
      const lineId = pink ? crypto.randomUUID() : undefined;
      const currentQty = pink ? 0 : (qtyByItem.get(product.id) ?? 0);
      const willExist = !pink && currentQty > 0;

      const applyLineMeta = (lineKey: string) => {
        if (prescriptionDosageValue) {
          updateItemDiscount(lineKey, "prescriptionDosage", prescriptionDosageValue);
        }
        if (itemToAdd.dosage != null && itemToAdd.dosage !== "") {
          updateItemDiscount(lineKey, "dosage", String(itemToAdd.dosage).trim());
        }
        if (itemToAdd.medication_order) {
          updateItemDiscount(lineKey, "medicationOrder", itemToAdd.medication_order);
          const s = medsByItem.get(product.id) ?? new Set<string>();
          s.add(itemToAdd.medication_order);
          extraOrderNames.forEach((o) => s.add(o));
          medsByItem.set(product.id, s);
          updateItemMetadata(lineKey, {
            medicationOrder: itemToAdd.medication_order,
            medicationOrders: Array.from(s),
            ...(itemToAdd.medication_order_entry
              ? { medication_order_entry: itemToAdd.medication_order_entry }
              : {}),
          });
        }
        if (pink) {
          updateItemMetadata(lineKey, {
            is_pink: true,
            reference_no: itemToAdd.reference_no || "",
          });
        }
        if (itemToAdd.alternative_item_code) {
          updateItemMetadata(lineKey, {
            original_drug: itemToAdd.item_code,
            alternative_drug: itemToAdd.alternative_item_code,
          });
        }
      };

      if (willExist) {
        const newQuantity = currentQty + cartQuantity;
        await onUpdateQuantity(product.id, newQuantity);
        qtyByItem.set(product.id, newQuantity);
        applyLineMeta(product.id);
        return "added";
      }

      let priceToUse = product.price;
      if ((isPharmacy || isHospitalPharmacy) && uomToUse && uomToUse !== product.uom && !selectedCustomer) {
        const priceInfo = await getItemPriceForCustomer(product.id, undefined, uomToUse);
        if (priceInfo?.success && priceInfo.price > 0) {
          priceToUse = priceInfo.price;
        }
      }

      const metaKey = pink && lineId ? lineId : product.id;
      await addToCartWithQuantity(
        {
          id: product.id,
          name: product.name,
          category: product.category || "General",
          price: priceToUse,
          image: product.image || "",
          available: product.available,
          uom: uomToUse,
          stock_uom: stockUom,
          conversion_factor: conversionFactor,
          item_code: product.id,
          has_batch_no: product.has_batch_no,
          has_serial_no: product.has_serial_no,
          // Stock already validated above using dispensed item UNIT/PACK conversion.
          ...(isAlternative ? { skip_stock_validation: true } : {}),
          ...(pink && {
            allowDuplicate: true,
            cartLineId: lineId,
            is_pink: true,
            reference_no: itemToAdd.reference_no || "",
          }),
          ...(itemToAdd.medication_order_entry && {
            medication_order_entry: itemToAdd.medication_order_entry,
          }),
          ...(itemToAdd.medication_order && {
            medicationOrder: itemToAdd.medication_order,
            medicationOrders: [itemToAdd.medication_order],
          }),
        },
        cartQuantity
      );

      if (!pink) {
        qtyByItem.set(product.id, cartQuantity);
      }

      setTimeout(() => applyLineMeta(metaKey), 100);
      return "added";
    },
    [
      products,
      isHospitalPharmacy,
      selectedCustomer,
      onUpdateQuantity,
      addToCartWithQuantity,
      updateItemDiscount,
      updateItemMetadata,
    ]
  );

  // Filtered customers based on search query
  const filteredCustomers =
    customerSearchQuery.trim() === ""
      ? customers
      : customers.filter(
          (customer) =>
            customer.name
              .toLowerCase()
              .includes(customerSearchQuery.toLowerCase()) ||
            customer.email
              .toLowerCase()
              .includes(customerSearchQuery.toLowerCase()) ||
            customer.phone.includes(customerSearchQuery) ||
            customer.tags.some((tag) =>
              tag.toLowerCase().includes(customerSearchQuery.toLowerCase())
            )
        );

  const visiblePatients = useMemo(() => {
    if (!isPharmacy && !isHospitalPharmacy) return [];
    if (isHospitalPharmacy) return patients;
    return patients.filter((patient) => {
      const patientName = (patient.patient_name || patient.name).toLowerCase();
      const matchesCustomer = filteredCustomers.some(
        (customer) => customer.name.toLowerCase() === patientName
      );
      return !matchesCustomer;
    });
  }, [patients, filteredCustomers, isPharmacy, isHospitalPharmacy]);

  const validateCustomer = () => {
    if (selectedCustomer) {
      return true;
    }
    if (isHospitalPharmacy && selectedPatient) {
      toast.error(
        `Selected ${party.lower} has no linked customer record. Please link a Customer on the Patient in ERPNext.`
      );
      return false;
    }
    toast.error(`Kindly choose ${party.lower}`);
    return false;
  };

  const resolveCustomerForSelectedPatient = async (): Promise<Customer | null> => {
    if (!selectedPatient?.name) return null;
    const resolved = await resolveCustomerForPatient(selectedPatient.name);
    if (!resolved) return null;
    const customer = customerFromResolvedRow(resolved);
    setSelectedCustomer(customer);
    return customer;
  };

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerSearchQuery(customer.name);
    setShowCustomerDropdown(false);
    setUserRemovedDefaultCustomer(false); // Reset flag when user explicitly selects a customer

    if (isHospitalPharmacy) {
      void resolvePatientForCustomer(customer.id).then((patient) => {
        setSelectedPatient(patient);
      });
    }
  };
  
  const handlePatientSelect = async (patient: Patient) => {
    if (!patient || !patient.name) {
      return;
    }
    setSelectedPatient(patient);
    const patientName = patient.patient_name || patient.name;
    setCustomerSearchQuery(patientName);
    // Force close dropdown immediately after selection - use multiple methods to ensure it closes
    setShowCustomerDropdown(false);
    // Use a ref to track if we should close
    setTimeout(() => {
      setShowCustomerDropdown(false);
      // Also blur the input if it's focused
      const input = document.activeElement as HTMLInputElement;
      if (input && input.tagName === 'INPUT') {
        input.blur();
      }
    }, 50);
    
    // Resolve linked Customer from Patient record (not just local name match)
    const resolvedCustomer = await resolveCustomerForPatient(patient.name);
    if (resolvedCustomer) {
      setSelectedCustomer(customerFromResolvedRow(resolvedCustomer));
    } else {
      const matchingCustomer = customers.find(
        (c) =>
          c.name.toLowerCase() === patientName.toLowerCase() ||
          c.customer_name?.toLowerCase() === patientName.toLowerCase()
      );
      if (matchingCustomer) {
        setSelectedCustomer(matchingCustomer);
      }
    }
    
    // Load medication orders and open modal — user adds items from there
    try {
      const [orders, history, historySummary, legacyDispensed, subscriptionPlans] = await Promise.all([
        getPendingInpatientMedicationOrders(patient.name),
        getPatientMedicationOrderHistory(patient.name, 50),
        getPatientHistorySummary(patient.name, 10),
        getPatientLegacyDispensedMedications(patient.name, 50),
        getSubscriptionMedicationPlans({ patient: patient.name, limit: 50 }),
      ]);
      setMedicationOrders(orders);
      setMedicationOrderHistory(history);
      setPatientHistorySummary(historySummary);
      setLegacyDispensedMedications(legacyDispensed);
      setSubscriptionMedicationPlans(subscriptionPlans);
      setSelectedOrders(new Set(orders.map((o) => o.name)));
      setSelectedSubscriptionItems(new Set());
      setShowMedicationOrdersModal(true);
      if (orders.length === 0 && history.length === 0) {
        toast.info("No medication orders found for this patient.");
      }
    } catch (error) {
      console.error("Error fetching medication orders:", error);
      toast.error("Failed to fetch medication orders.");
    }
  };
  
  const handleAddOrdersToCart = async (alternatives?: Record<string, string>) => {
    if (selectedOrders.size === 0) {
      toast.warning("Please select at least one medication order.");
      return;
    }
    
    const ordersToAdd = medicationOrders.filter(order => selectedOrders.has(order.name));
    const selectedOrderNames = Array.from(new Set(ordersToAdd.map((o) => o.name).filter(Boolean)));
    
    const itemsToAdd: MedicationOrderLineInput[] = [];
    const availability = productAvailability();
    let validationFailed = false;

    for (const order of ordersToAdd) {
      for (let idx = 0; idx < order.items.length; idx++) {
        const item = order.items[idx];
        const itemCode = resolveMedicationItemCode(item);
        if (!itemCode) continue;
        const lineKey = `${order.name}::${idx}::${itemCode}`;
        const alternativeCode = alternatives?.[lineKey]?.trim();
        const effectiveCode = alternativeCode || itemCode;
        const displayName = resolveMedicationDisplayName(item);
        const avail = availability[effectiveCode];
        if (avail === undefined) {
          toast.error(`${displayName} not found in product list.`);
          validationFailed = true;
          break;
        }
        const qty = item.quantity ?? 1;
        if (avail <= 0 || avail < qty) {
          if (!alternativeCode) {
            toast.error(`Insufficient stock for ${displayName}. Select an alternative drug.`);
            validationFailed = true;
            break;
          }
        }
        itemsToAdd.push({
          item_code: itemCode,
          quantity: qty,
          uom: item.uom,
          dosage: item.dosage || undefined,
          patient_frequency: item.patient_frequency,
          drug_name: displayName || undefined,
          medication_order: order.name,
          medication_order_entry: item.medication_order_entry,
          is_pink: item.is_pink,
          reference_no: item.reference_no,
          alternative_item_code: alternativeCode || undefined,
          line_key: lineKey,
        });
      }
      if (validationFailed) break;
    }

    if (validationFailed || itemsToAdd.length === 0) {
      return;
    }
    
    const loadingToast = toast.loading(`Adding ${itemsToAdd.length} item(s) to cart...`);
    
    try {
      let addedCount = 0;
      let notFoundCount = 0;
      let noStockCount = 0;
      const qtyByItem = new Map<string, number>();
      const medsByItem = new Map<string, Set<string>>();
      cartItems.forEach((ci) => {
        qtyByItem.set(ci.id, ci.quantity);
        const existing = (ci as unknown as { medicationOrders?: string[] }).medicationOrders;
        if (Array.isArray(existing) && existing.length) {
          medsByItem.set(ci.id, new Set(existing));
        }
      });
      
      for (const itemToAdd of itemsToAdd) {
        const result = await addMedicationOrderLineToCart(
          itemToAdd,
          qtyByItem,
          medsByItem,
          selectedOrderNames
        );
        if (result === "added") addedCount++;
        else if (result === "no_stock") noStockCount++;
        else notFoundCount++;
      }
      
      toast.dismiss(loadingToast);
      
      if (noStockCount > 0) {
        toast.error(`${noStockCount} item(s) have no stock. Select alternative drugs where needed.`);
        return;
      }
      
      if (addedCount > 0 && notFoundCount === 0) {
        toast.success(`Successfully added ${addedCount} item(s) to cart.`);
      } else if (addedCount > 0 && notFoundCount > 0) {
        toast.warning(`Added ${addedCount} item(s) to cart. ${notFoundCount} item(s) not found.`);
      } else {
        toast.error(`Failed to add items. None of the items were found in the product list.`);
      }
      
      // Close modal and reset selection
      setShowMedicationOrdersModal(false);
      setSelectedOrders(new Set());
      
    } catch (error) {
      console.error('Error adding items to cart:', error);
      toast.dismiss(loadingToast);
      toast.error('Failed to add items to cart. Please try again.');
    }
  };

  const openPatientDetailsModal = async () => {
    let patient = selectedPatient;
    if (!patient?.name && selectedCustomer?.id && isHospitalPharmacy) {
      const resolved = await resolvePatientForCustomer(selectedCustomer.id);
      if (resolved) {
        patient = resolved;
        setSelectedPatient(resolved);
      }
    }
    if (!patient?.name) {
      toast.error("Patient not found.");
      return;
    }
    if (patientHistorySummary?.patient?.name !== patient.name) {
      await loadPatientHistorySummary(patient.name);
    }
    setShowPatientDetailsModal(true);
  };

  const openMedicationOrdersModal = async () => {
    let patientToUse = selectedPatient || (selectedCustomer ? patients.find(
      p => (p.patient_name || p.name).toLowerCase() === selectedCustomer.name.toLowerCase()
    ) : null);

    if (!patientToUse?.name && selectedCustomer?.id && isHospitalPharmacy) {
      const resolved = await resolvePatientForCustomer(selectedCustomer.id);
      if (resolved) {
        patientToUse = resolved;
        setSelectedPatient(resolved);
      }
    }

    const patientId = patientToUse?.name ?? selectedCustomer?.id ?? selectedCustomer?.name;
    if (!patientId) {
      toast.error("Patient not found.");
      return;
    }
    try {
      const [orders, history, historySummary, legacyDispensed, subscriptionPlans] = await Promise.all([
        getPendingInpatientMedicationOrders(patientId),
        getPatientMedicationOrderHistory(patientId, 50),
        getPatientHistorySummary(patientId, 10),
        getPatientLegacyDispensedMedications(patientId, 50),
        getSubscriptionMedicationPlans({ patient: patientId, limit: 50 }),
      ]);
      setMedicationOrders(orders);
      setMedicationOrderHistory(history);
      setPatientHistorySummary(historySummary);
      setLegacyDispensedMedications(legacyDispensed);
      setSubscriptionMedicationPlans(subscriptionPlans);
      setSelectedOrders(new Set(orders.map(o => o.name)));
      setSelectedSubscriptionItems(new Set());
      setShowMedicationOrdersModal(true);
      if (orders.length === 0 && history.length === 0) {
        toast.info("No medication orders found for this patient.");
      }
    } catch (error) {
      console.error('Error fetching medication orders:', error);
      toast.error("Failed to fetch medication orders.");
    }
  };

  const handleAddHistoryItemsToCart = async (alternatives?: Record<string, string>) => {
    if (selectedHistoryItems.size === 0) {
      toast.warning("Please select at least one history item.");
      return;
    }

    const itemsToAdd: MedicationOrderLineInput[] = [];
    const availability = productAvailability();
    let validationFailed = false;
    const selectedOrderNames = new Set<string>();

    for (const order of medicationOrderHistory) {
      for (let idx = 0; idx < order.items.length; idx++) {
        const item = order.items[idx];
        const itemCode = resolveMedicationItemCode(item);
        if (!itemCode) continue;
        const lineKey = `${order.name}::${idx}::${itemCode}`;
        if (!selectedHistoryItems.has(lineKey)) continue;

        const alternativeCode = alternatives?.[lineKey]?.trim();
        const effectiveCode = alternativeCode || itemCode;
        const displayName = resolveMedicationDisplayName(item);
        const avail = availability[effectiveCode];
        const qty = item.quantity ?? 1;

        if (avail === undefined) {
          if (!alternativeCode) {
            toast.error(
              `${displayName} not found in product list. Select an alternative drug.`
            );
            validationFailed = true;
            break;
          }
        } else if (avail <= 0 || avail < qty) {
          if (!alternativeCode) {
            toast.error(`Insufficient stock for ${displayName}. Select an alternative drug.`);
            validationFailed = true;
            break;
          }
        }

        if (order.name) selectedOrderNames.add(order.name);
        itemsToAdd.push({
          item_code: itemCode,
          quantity: qty,
          uom: item.uom,
          dosage: item.dosage || undefined,
          patient_frequency: item.patient_frequency,
          drug_name: displayName || undefined,
          medication_order: order.name,
          medication_order_entry: item.medication_order_entry,
          is_pink: item.is_pink,
          reference_no: item.reference_no,
          alternative_item_code: alternativeCode || undefined,
          line_key: lineKey,
        });
      }
      if (validationFailed) break;
    }

    if (validationFailed) return;

    if (itemsToAdd.length === 0) {
      toast.warning("No valid items selected.");
      return;
    }

    const loadingToast = toast.loading(`Adding ${itemsToAdd.length} history item(s) to cart...`);
    try {
      let addedCount = 0;
      let notFoundCount = 0;
      let noStockCount = 0;
      const qtyByItem = new Map<string, number>();
      const medsByItem = new Map<string, Set<string>>();
      cartItems.forEach((ci) => {
        qtyByItem.set(ci.id, ci.quantity);
        const existing = ci.medicationOrders;
        if (Array.isArray(existing) && existing.length) {
          medsByItem.set(ci.id, new Set(existing));
        }
      });

      for (const itemToAdd of itemsToAdd) {
        const result = await addMedicationOrderLineToCart(
          itemToAdd,
          qtyByItem,
          medsByItem,
          Array.from(selectedOrderNames)
        );
        if (result === "added") addedCount++;
        else if (result === "no_stock") noStockCount++;
        else notFoundCount++;
      }

      toast.dismiss(loadingToast);

      if (noStockCount > 0) {
        toast.error(`${noStockCount} item(s) have no stock. Select alternative drugs where needed.`);
        return;
      }

      if (addedCount > 0 && notFoundCount === 0) {
        toast.success(`Successfully added ${addedCount} history item(s).`);
      } else if (addedCount > 0) {
        toast.warning(`Added ${addedCount} item(s). ${notFoundCount} item(s) not found.`);
      } else {
        toast.error("No history items were added.");
      }

      setShowMedicationOrdersModal(false);
      setSelectedHistoryItems(new Set());
    } catch {
      toast.dismiss(loadingToast);
      toast.error("Failed to add history items to cart.");
    }
  };

  const handleAddLegacyItemsToCart = async (alternatives?: Record<string, string>) => {
    if (selectedLegacyItems.size === 0) {
      toast.warning("Please select at least one legacy item.");
      return;
    }

    const itemsToAdd: MedicationOrderLineInput[] = [];
    const availability = productAvailability();
    let validationFailed = false;

    for (const txn of legacyDispensedMedications) {
      for (let idx = 0; idx < (txn.items || []).length; idx++) {
        const item = txn.items[idx];
        const lineKey = legacyMedicationLineKey(txn.name, idx, item);
        if (!selectedLegacyItems.has(lineKey)) continue;

        const legacyCode = resolveLegacyMedicationItemCode(item);
        const displayName = resolveLegacyMedicationDisplayName(item);
        const alternativeCode = alternatives?.[lineKey]?.trim();
        const effectiveCode = alternativeCode || legacyCode;

        if (!effectiveCode) {
          toast.error(`Select an alternative drug for ${displayName}.`);
          validationFailed = true;
          break;
        }

        const avail = availability[effectiveCode];
        if (avail === undefined) {
          if (!alternativeCode) {
            toast.error(
              `${displayName} uses legacy code ${legacyCode || "—"}. Select an alternative drug.`
            );
            validationFailed = true;
            break;
          }
          toast.error(`Alternative ${effectiveCode} not found in product list.`);
          validationFailed = true;
          break;
        }

        const qty = Number(item.show_qty ?? 1) || 1;
        if (avail <= 0 || avail < qty) {
          if (!alternativeCode) {
            toast.error(`Insufficient stock for ${displayName}. Select an alternative drug.`);
            validationFailed = true;
            break;
          }
        }

        // Dispense the mapped POS item; keep legacy code as original when an alt was chosen.
        itemsToAdd.push({
          item_code: alternativeCode ? legacyCode || alternativeCode : effectiveCode,
          quantity: qty,
          uom: item.show_uom || undefined,
          drug_name: displayName || undefined,
          alternative_item_code: alternativeCode || undefined,
          line_key: lineKey,
          reference_no: txn.trans_no || txn.name,
        });
      }
      if (validationFailed) break;
    }

    if (validationFailed || itemsToAdd.length === 0) {
      return;
    }

    const loadingToast = toast.loading(`Adding ${itemsToAdd.length} legacy item(s) to cart...`);
    try {
      let addedCount = 0;
      let notFoundCount = 0;
      let noStockCount = 0;
      const qtyByItem = new Map<string, number>();
      const medsByItem = new Map<string, Set<string>>();
      cartItems.forEach((ci) => {
        qtyByItem.set(ci.id, ci.quantity);
        const existing = (ci as unknown as { medicationOrders?: string[] }).medicationOrders;
        if (Array.isArray(existing) && existing.length) {
          medsByItem.set(ci.id, new Set(existing));
        }
      });

      for (const itemToAdd of itemsToAdd) {
        const result = await addMedicationOrderLineToCart(itemToAdd, qtyByItem, medsByItem);
        if (result === "added") addedCount++;
        else if (result === "no_stock") noStockCount++;
        else notFoundCount++;
      }

      toast.dismiss(loadingToast);

      if (noStockCount > 0) {
        toast.error(`${noStockCount} item(s) have no stock. Select alternative drugs where needed.`);
        return;
      }

      if (addedCount > 0 && notFoundCount === 0) {
        toast.success(`Successfully added ${addedCount} legacy item(s) to cart.`);
      } else if (addedCount > 0) {
        toast.warning(`Added ${addedCount} item(s). ${notFoundCount} item(s) not found.`);
      } else {
        toast.error("No legacy items were added.");
      }

      setShowMedicationOrdersModal(false);
      setSelectedLegacyItems(new Set());
    } catch (error) {
      console.error("Error adding legacy items to cart:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to add legacy items to cart.");
    }
  };

  const handleAddSubscriptionItemsToCart = async (alternatives?: Record<string, string>) => {
    if (selectedSubscriptionItems.size === 0) {
      toast.warning("Please select at least one monthly medication item.");
      return;
    }

    const itemsToAdd: MedicationOrderLineInput[] = [];
    const availability = productAvailability();
    let validationFailed = false;

    for (const plan of subscriptionMedicationPlans) {
      for (let idx = 0; idx < (plan.medications || []).length; idx++) {
        const item = plan.medications[idx];
        const lineKey = subscriptionMedicationLineKey(plan.name, idx, item);
        if (!selectedSubscriptionItems.has(lineKey)) continue;

        if (item.is_active === 0) {
          toast.error(`${resolveSubscriptionItemDisplayName(item)} is inactive on the plan.`);
          validationFailed = true;
          break;
        }

        const planCode = resolveSubscriptionItemCode(item);
        const displayName = resolveSubscriptionItemDisplayName(item);
        const alternativeCode = alternatives?.[lineKey]?.trim();
        const effectiveCode = alternativeCode || planCode;

        if (!effectiveCode) {
          toast.error(`Select an alternative drug for ${displayName}.`);
          validationFailed = true;
          break;
        }

        const avail = availability[effectiveCode];
        if (avail === undefined) {
          if (!alternativeCode) {
            toast.error(
              `${displayName} uses code ${planCode || "—"}. Select an alternative drug.`
            );
            validationFailed = true;
            break;
          }
          toast.error(`Alternative ${effectiveCode} not found in product list.`);
          validationFailed = true;
          break;
        }

        const qty = Number(item.qty_per_cycle ?? 1) || 1;
        if (avail <= 0 || avail < qty) {
          if (!alternativeCode) {
            toast.error(`Insufficient stock for ${displayName}. Select an alternative drug.`);
            validationFailed = true;
            break;
          }
        }

        itemsToAdd.push({
          item_code: alternativeCode ? planCode || alternativeCode : effectiveCode,
          quantity: qty,
          dosage: item.dosage != null && item.dosage !== "" ? String(item.dosage) : undefined,
          patient_frequency: item.patient_frequency || undefined,
          drug_name: displayName || undefined,
          alternative_item_code: alternativeCode || undefined,
          line_key: lineKey,
          reference_no: plan.name,
        });
      }
      if (validationFailed) break;
    }

    if (validationFailed || itemsToAdd.length === 0) {
      return;
    }

    const loadingToast = toast.loading(`Adding ${itemsToAdd.length} monthly medication item(s) to cart...`);
    try {
      let addedCount = 0;
      let notFoundCount = 0;
      let noStockCount = 0;
      const qtyByItem = new Map<string, number>();
      const medsByItem = new Map<string, Set<string>>();
      cartItems.forEach((ci) => {
        qtyByItem.set(ci.id, ci.quantity);
        const existing = (ci as unknown as { medicationOrders?: string[] }).medicationOrders;
        if (Array.isArray(existing) && existing.length) {
          medsByItem.set(ci.id, new Set(existing));
        }
      });

      for (const itemToAdd of itemsToAdd) {
        const result = await addMedicationOrderLineToCart(itemToAdd, qtyByItem, medsByItem);
        if (result === "added") addedCount++;
        else if (result === "no_stock") noStockCount++;
        else notFoundCount++;
      }

      toast.dismiss(loadingToast);

      if (noStockCount > 0) {
        toast.error(`${noStockCount} item(s) have no stock. Select alternative drugs where needed.`);
        return;
      }

      if (addedCount > 0 && notFoundCount === 0) {
        toast.success(`Successfully added ${addedCount} monthly medication item(s) to cart.`);
      } else if (addedCount > 0) {
        toast.warning(`Added ${addedCount} item(s). ${notFoundCount} item(s) not found.`);
      } else {
        toast.error("No monthly medication items were added.");
      }

      setShowMedicationOrdersModal(false);
      setSelectedSubscriptionItems(new Set());
    } catch (error) {
      console.error("Error adding monthly medication items to cart:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to add monthly medication items to cart.");
    }
  };

  const handleCreatePatientVisit = async () => {
    const patientToUse = selectedPatient || (selectedCustomer ? patients.find(
      p => (p.patient_name || p.name).toLowerCase() === selectedCustomer.name.toLowerCase()
    ) : null);
    const patientId = patientToUse?.name ?? selectedCustomer?.id ?? selectedCustomer?.name;
    if (!patientId) {
      toast.warning("Select a patient first.");
      return;
    }
    try {
      setIsCreatingVisit(true);
      const result = await createPatientVisit(patientId);
      if (result?.name) {
        setCreatedVisitRef({
          doctype: result.doctype,
          name: result.name,
          visit_type: result.visit_type || null,
          visit_date: toDateOnly(result.visit_date) || todayISODate(),
        });
        setPatientVisitCreatedSignal((s) => s + 1);
        toast.success(`Created pharmacy visit: ${result.name}`);
      } else {
        toast.error("Failed to create patient visit.");
      }
    } catch (error) {
      toast.error(extractErrorFromException(error, "Failed to create patient visit"));
    } finally {
      setIsCreatingVisit(false);
    }
  };

  const handleSelectPatientVisit = (visit: {
    doctype: string;
    name: string;
    visit_type?: string | null;
    visit_date?: string | null;
  }) => {
    if (!visit?.name) return;
    setCreatedVisitRef({
      doctype: visit.doctype || "Patient Visit",
      name: visit.name,
      visit_type: visit.visit_type || null,
      visit_date: toDateOnly(visit.visit_date) || null,
    });
    setPatientVisitCreatedSignal((s) => s + 1);
    toast.success(`Using pharmacy visit: ${visit.name}`);
  };

  const handleSaveCustomer = async (newCustomer: Partial<Customer> & { customer_name?: string }) => {

    // Automatically select the newly created customer in the cart
    if (newCustomer && newCustomer.customer_name) {
      try {
        // Fetch the full customer data using the customer_name returned from backend
        const response = await fetch(`/api/method/klik_pos.api.customer.get_customer_info?customer_name=${encodeURIComponent(newCustomer.customer_name)}`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resData = await response.json();

        if (resData.message) {
          // Convert the ERP customer data to our Customer format
          const erpCustomer = resData.message;
          const customerToSelect: Customer = {
            id: erpCustomer.name,
            name: erpCustomer.customer_name || erpCustomer.name,
            email: erpCustomer.email_id || '',
            phone: erpCustomer.mobile_no || '',
            type: erpCustomer.customer_type === "Company" ? "company" : "individual",
            address: {
              street: '',
              city: '',
              state: '',
              zipCode: '',
              country: 'Saudi Arabia'
            },
            loyaltyPoints: erpCustomer.custom_loyalty_points || 0,
            totalSpent: erpCustomer.custom_total_spent || 0,
            totalOrders: erpCustomer.custom_total_orders || 0,
            preferredPaymentMethod: 'Cash',
            tags: erpCustomer.custom_tags?.split(',').filter(Boolean) || [],
            status: erpCustomer.custom_status || 'active',
            createdAt: erpCustomer.creation || new Date().toISOString()
          };

          setSelectedCustomer(customerToSelect);
          setCustomerSearchQuery(''); // Clear the search query

          // Also refresh the customers list to include the new customer
          if (refetchCustomers) {
            refetchCustomers();
          }
        }
      } catch (error) {
        console.error('Error fetching customer details:', error);
        // Fallback: create a basic customer object from the returned data
        const customerToSelect: Customer = {
          id: newCustomer.customer_name || '',
          name: newCustomer.customer_name || '',
          email: '',
          phone: '',
          type: 'individual',
          address: {
            street: '',
            city: '',
            state: '',
            zipCode: '',
            country: 'Saudi Arabia'
          },
          loyaltyPoints: 0,
          totalSpent: 0,
          totalOrders: 0,
          preferredPaymentMethod: 'Cash',
          tags: [],
          status: 'active',
          createdAt: new Date().toISOString()
        };

        setSelectedCustomer(customerToSelect);
        setCustomerSearchQuery('');
      }
    }

    setShowAddCustomerModal(false);
    setPrefilledCustomerName(""); // Clear the prefilled name
    setPrefilledData({}); // Clear the prefilled data
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCompletePayment = async (paymentData: any) => {
    console.log("OrderSummary: Payment completed, invoice created - modal stays open for preview", paymentData);
    // Don't close modal or clear cart - let user see invoice preview
    // Cart will be cleared when modal is closed via "New Order" button
  };

  // Build medication-label rows (dosage / frequency / batch / expiry) from a set of cart lines.
  // Shared by the hospital dispense flow and the outpatient (Rose) checkout flow.
  const buildDispensedLabels = useCallback(
    async (items: CartItem[]): Promise<DispensedLabelItem[]> => {
      const labelsFromCart: DispensedLabelItem[] = items.map((item) => {
        const lineKey = getLineKey(item);
        const lineDiscount = ((itemDiscounts[item.id] || itemDiscounts[lineKey]) || {}) as {
          dosage?: string;
          prescriptionDosage?: string;
          batchNumber?: string;
        };
        const dosage = lineDiscount.dosage;
        const frequency = lineDiscount.prescriptionDosage;
        const batchNo =
          lineDiscount.batchNumber ||
          (item as CartItem & { batch_no?: string }).batch_no ||
          "N/A";
        return {
          itemCode: item.item_code || item.id,
          itemName: item.name,
          dosage:
            dosage === null || dosage === undefined || String(dosage).trim() === ""
              ? "N/A"
              : String(dosage),
          frequency: typeof frequency === "string" && frequency.trim() ? frequency : "N/A",
          batchNo,
          expiryDate: "N/A",
        };
      });

      const batchNumbers = Array.from(
        new Set(
          labelsFromCart.map((label) => label.batchNo).filter((batchNo) => batchNo && batchNo !== "N/A")
        )
      );

      if (batchNumbers.length > 0) {
        try {
          const batchDetails = await getBatchLabelDetails(batchNumbers);
          return labelsFromCart.map((label) => {
            const matchedBatch = batchDetails[label.batchNo];
            return {
              ...label,
              expiryDate: matchedBatch?.expiry_date || "N/A",
              batchNo: matchedBatch?.batch_no || label.batchNo,
            };
          });
        } catch (batchError) {
          console.error("Failed to fetch batch expiry details for labels:", batchError);
          return labelsFromCart;
        }
      }
      return labelsFromCart;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemDiscounts]
  );

  const handleClosePaymentDialog = async (paymentCompleted?: boolean) => {
    setShowPaymentDialog(false);

    const soldItems = getSoldLineItems();
    // Capture cart lines before the cart is cleared so we can offer label printing (OP/Rose).
    const dispensedItemsForLabels = paymentCompleted && isPharmacy && !isHospitalPharmacy
      ? [...cartItems]
      : [];

    // Only clear cart if payment was completed
    if (paymentCompleted) {
      // console.log("OrderSummary: Payment was completed - clearing cart for next order");
      handleClearCart();
    } else {
      console.log("OrderSummary: Payment was not completed - keeping cart items");
    }

    // Outpatient (Rose) pharmacy: build medication labels for the just-sold items so the
    // pharmacist can print them, same as the hospital dispense flow (PK-11).
    if (dispensedItemsForLabels.length > 0) {
      try {
        const labels = await buildDispensedLabels(dispensedItemsForLabels);
        setLastDispensedLabelItems(labels);
        setShowOpDispenseLabels(labels.length > 0);
      } catch (labelError) {
        console.error("OrderSummary: Failed to build medication labels:", labelError);
      }
    }

    // Refresh stock so cashier can see updated availability
    try {
      const success = await refreshStockOnly();
      if (success) {
        // toast.success("Stock updated - ready for next order!");
      } else {
        console.log("OrderSummary: No stock updates needed");
      }

      if (soldItems.length > 0) {
        try {
          await refreshSoldItemPickers(soldItems);
        } catch (error) {
          console.error("OrderSummary: Failed to refresh batch/serial/lot pickers:", error);
        }
      }
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("OrderSummary: Failed to refresh stock:", error);
      const errorMessage = error?.message || "Unknown error";
      toast.error(`Failed to update stock: ${errorMessage}`);
    }
  };

  // Hide the outpatient "Print Labels" affordance once a new order is started.
  useEffect(() => {
    if (cartItems.length > 0 && showOpDispenseLabels) {
      setShowOpDispenseLabels(false);
    }
  }, [cartItems.length, showOpDispenseLabels]);

  const handleStartNewOrder = async () => {
    await handlePostSaleComplete();
  };

  const printSalesOrder = (salesOrderName: string) => {
    const params = new URLSearchParams();
    params.set("doctype", "Sales Order");
    params.set("name", salesOrderName);
    params.set("format", "Standard");
    params.set("trigger_print", "1");
    params.set("no_letterhead", "0");
    const base = typeof window !== "undefined" ? window.location.origin : "";
    window.open(`${base}/printview?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const printMedicationLabels = (labels: DispensedLabelItem[]) => {
    if (!labels.length) {
      toast.error("No dispensed medicines found for label printing.");
      return;
    }

const pages = labels.map((label) => `
  <div class="label-page">
    <div class="medication-label">
      <div class="title">Medication Label</div>
      <div class="item">${label.itemCode} - ${label.itemName}</div>
      <div class="detail-row"><strong>Dosage:</strong> ${label.dosage}</div>
      <div class="detail-row"><strong>Frequency:</strong> ${label.frequency}</div>
      <div class="detail-row"><strong>Batch No:</strong> ${label.batchNo}</div>
      <div class="detail-row"><strong>Expiry Date:</strong> ${label.expiryDate}</div>
    </div>
  </div>
`);

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Unable to open print window. Please allow popups and try again.");
      return;
    }

    printWindow.document.write(
      "<html><head><style>" + MEDICATION_LABEL_CSS + "</style></head><body>" +
      pages.join("") +
      '<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}};</script></body></html>'
    );
    printWindow.document.close();
  };

  const showPostDispenseActions =
    isHospitalPharmacy &&
    !!lastDispensedSalesOrder &&
    !!lastDispensedCartSignature &&
    lastDispensedCartSignature === getCartSignature(cartItems);

  const openPharmacyServiceModal = (lineKey: string, itemName: string) => {
    setPharmacyServiceParent({ lineKey, itemName });
    setShowPharmacyServiceModal(true);
  };

  const handleSelectPharmacyService = async (service: PharmacyServiceItem) => {
    if (!pharmacyServiceParent) return;
    const parentLineKey = pharmacyServiceParent.lineKey;
    const servicePrice = service.price || 0;
    try {
      await addToCartWithQuantity(
        {
          id: service.id,
          name: service.name,
          category: service.category || "Service",
          price: servicePrice,
          image: service.image || "",
          uom: service.uom,
          item_code: service.id,
          item_tax_template: service.item_tax_template,
          allowDuplicate: true,
          is_pharmacy_service: true,
          parent_cart_line_id: parentLineKey,
          ...(servicePrice === 0 ? { rate_edited: true } : {}),
        },
        1
      );

      const matchingServices = useCartStore
        .getState()
        .cartItems.filter(
          (ci) =>
            (ci as CartItem & { is_pharmacy_service?: boolean }).is_pharmacy_service &&
            (ci as CartItem & { parent_cart_line_id?: string }).parent_cart_line_id === parentLineKey &&
            (ci.item_code || ci.id) === service.id
        );
      const addedService = matchingServices[matchingServices.length - 1];
      if (addedService) {
        setExpandedItems((prev) => new Set([...prev, getLineKey(addedService)]));
      }

      toast.success(`Added ${service.name} to cart`);
      setShowPharmacyServiceModal(false);
      setPharmacyServiceParent(null);
    } catch (error) {
      console.error("Failed to add pharmacy service:", error);
      toast.error("Failed to add service to cart");
    }
  };

  const getHospitalCareReference = (): { type: string; name: string } | null => {
    if (createdVisitRef?.name) {
      return {
        type: createdVisitRef.doctype || "Patient Visit",
        name: createdVisitRef.name,
      };
    }

    const linkedOrders = Array.from(
      new Set(
        cartItems.flatMap((item) => {
          const many = (item as CartItem & { medicationOrders?: string[] }).medicationOrders || [];
          const one = (item as CartItem & { medicationOrder?: string }).medicationOrder;
          return [...many, ...(one ? [one] : [])].filter(Boolean);
        })
      )
    );

    for (const orderName of linkedOrders) {
      const sourceOrder = [...medicationOrders, ...medicationOrderHistory].find((o) => o.name === orderName);
      if (sourceOrder?.custom_reference_name) {
        return {
          type: sourceOrder.custom_reference_type || "Patient Visit",
          name: sourceOrder.custom_reference_name,
        };
      }
    }

    return null;
  };

  const openDispenseDateModal = () => {
    setDispenseDateDraft(dispenseRecordDate || todayISODate());
    setShowDispenseDateModal(true);
  };

  const applyDispenseDateDraft = () => {
    const next = toDateOnly(dispenseDateDraft);
    if (!next) {
      toast.error("Enter a valid dispense date.");
      return;
    }
    setDispenseRecordDate(next);
    setShowDispenseDateModal(false);
  };

  const usePatientVisitDate = async () => {
    const fromVisitRef = visitDateFromRecord(createdVisitRef);
    if (fromVisitRef) {
      setDispenseDateDraft(fromVisitRef);
      setDispenseRecordDate(fromVisitRef);
      setShowDispenseDateModal(false);
      return;
    }

    const careReference = getHospitalCareReference();
    const historyMatch = (patientHistorySummary?.visits || []).find((visit) => {
      const row = visit as Record<string, unknown>;
      return String(row.name || "") === (careReference?.name || createdVisitRef?.name || "");
    });
    const fromHistory = visitDateFromRecord(historyMatch as Record<string, unknown> | undefined);
    if (fromHistory) {
      setDispenseDateDraft(fromHistory);
      setDispenseRecordDate(fromHistory);
      setShowDispenseDateModal(false);
      return;
    }

    if (!careReference?.name) {
      toast.error("Select or create a Patient Visit first.");
      return;
    }

    setIsResolvingVisitDate(true);
    try {
      const fetched = await getPatientVisitDate(careReference.type, careReference.name);
      if (!fetched) {
        toast.error("Could not load the patient visit date.");
        return;
      }
      setDispenseDateDraft(fetched);
      setDispenseRecordDate(fetched);
      setShowDispenseDateModal(false);
    } finally {
      setIsResolvingVisitDate(false);
    }
  };

  const validateHospitalDispense = (): boolean => {
    if (!getHospitalCareReference()) {
      toast.error(
        "Select or create a Patient Visit before dispensing. Open Medication Orders → Patient Visit."
      );
      return false;
    }

    const missingMedicationDetails = cartItems
      .filter((item) => !(item as CartItem & { is_pharmacy_service?: boolean }).is_pharmacy_service)
      .map((item) => {
        const lineKey = getLineKey(item);
        const lineDiscount = ((itemDiscounts[item.id] || itemDiscounts[lineKey]) || {}) as {
          dosage?: string;
          prescriptionDosage?: string;
        };
        const dosageRaw = lineDiscount.dosage;
        const frequencyRaw = lineDiscount.prescriptionDosage;
        const hasDosage = dosageRaw !== null && dosageRaw !== undefined && String(dosageRaw).trim() !== "";
        const hasFrequency = typeof frequencyRaw === "string" && frequencyRaw.trim() !== "";
        if (hasDosage && hasFrequency) return null;
        return item.name || item.item_code || item.id;
      })
      .filter(Boolean) as string[];

    if (missingMedicationDetails.length > 0) {
      const uniqueItems = Array.from(new Set(missingMedicationDetails));
      toast.error(
        `Missing dosage or prescription frequency for: ${uniqueItems.join(", ")}. Kindly update Patient Medication Order items before dispensing.`
      );
      return false;
    }

    const missingPinkReference = cartItems
      .filter((item) => (item as CartItem).is_pink)
      .filter((item) => !String((item as CartItem).reference_no || "").trim())
      .map((item) => item.name || item.item_code || item.id);

    if (missingPinkReference.length > 0) {
      const uniqueItems = Array.from(new Set(missingPinkReference));
      toast.error(`Reference is required for: ${uniqueItems.join(", ")}.`);
      return false;
    }

    const missingServiceAmount = cartItems
      .filter((item) => (item as CartItem & { is_pharmacy_service?: boolean }).is_pharmacy_service)
      .filter((item) => getDiscountedPrice(item) <= 0)
      .map((item) => item.name || item.item_code || item.id);

    if (missingServiceAmount.length > 0) {
      const uniqueItems = Array.from(new Set(missingServiceAmount));
      toast.error(`Enter an amount for service: ${uniqueItems.join(", ")}.`);
      return false;
    }

    return true;
  };

  const buildHospitalDispensePayload = async () => {
    if (!selectedCustomer) return null;

    const allMedicationOrders = Array.from(
      new Set(
        cartItems.flatMap((item) => {
          const many = (item as CartItem & { medicationOrders?: string[] }).medicationOrders || [];
          const one = (item as CartItem & { medicationOrder?: string }).medicationOrder;
          return [...many, ...(one ? [one] : [])].filter(Boolean);
        })
      )
    );
    const careReference = getHospitalCareReference();
    const finalReferenceType = careReference?.type || "Patient Visit";
    const finalReferenceName = careReference?.name || "";

    const patientToUse =
      selectedPatient ||
      (selectedCustomer
        ? patients.find(
            (p) => (p.patient_name || p.name).toLowerCase() === selectedCustomer.name.toLowerCase()
          )
        : null);
    const patientIdForSo =
      patientToUse?.name ||
      (selectedCustomer && isHospitalPharmacy
        ? (await resolvePatientForCustomer(selectedCustomer.id))?.name
        : undefined);

    const cartSnapshot = cartItems.map((item) => ({
      ...item,
      cartLineId: (item as CartItem & { cartLineId?: string }).cartLineId || item.id,
    }));

    return {
      customer: { id: selectedCustomer.id },
      ...(patientIdForSo ? { patient: patientIdForSo } : {}),
      items: cartItems.map((item) => {
        const lineKey = getLineKey(item);
        const lineDiscount = (itemDiscounts[lineKey] || itemDiscounts[item.id] || {}) as {
          batchNumber?: string;
          serialNumber?: string;
          dispensingLot?: string;
          dosage?: string;
          prescriptionDosage?: string;
          medicationOrder?: string;
        };
        const cartLine = item as CartItem;
        const effectiveItemCode = cartLine.alternative_drug || item.item_code || item.id;
        const medicationOrderName =
          cartLine.medicationOrder ||
          lineDiscount.medicationOrder ||
          (Array.isArray(cartLine.medicationOrders) ? cartLine.medicationOrders[0] : undefined);
        return {
          id: effectiveItemCode,
          item_code: effectiveItemCode,
          quantity: item.quantity,
          price: getDiscountedPrice(item),
          uom: item.uom,
          batchNumber: lineDiscount.batchNumber || cartLine.batch_no,
          serialNumber: lineDiscount.serialNumber || cartLine.serial_no,
          dispensingLot:
            lineDiscount.dispensingLot ||
            (cartLine as CartItem & { dispensing_lot?: string }).dispensing_lot,
          dosage: lineDiscount.dosage ?? cartLine.dosage,
          prescriptionDosage: lineDiscount.prescriptionDosage ?? cartLine.prescriptionDosage,
          medication_order: medicationOrderName,
          medication_order_entry: cartLine.medication_order_entry,
          reference_no: cartLine.reference_no,
          is_pink: cartLine.is_pink ? 1 : 0,
          alternative_drug: cartLine.alternative_drug || undefined,
          alternative_medicine: cartLine.alternative_drug || undefined,
          original_drug: cartLine.original_drug || undefined,
          item_tax_template: (item as { item_tax_template?: string }).item_tax_template || null,
        };
      }),
      medication_orders: allMedicationOrders,
      base_reference: "Patient Medication Order",
      base_reference_name: allMedicationOrders.join(", "),
      reference_type: finalReferenceType,
      reference_name: finalReferenceName,
      ...(dispenseRemarks.trim() ? { custom_remarks: dispenseRemarks.trim() } : {}),
      ...(dispenseRecordDate ? { transaction_date: dispenseRecordDate } : {}),
      hold_payload: {
        cart_items: cartSnapshot,
        item_discounts: itemDiscounts,
        patient: selectedPatient,
        dispense_remarks: dispenseRemarks,
        created_visit_ref: createdVisitRef,
        dispense_date: dispenseRecordDate,
      },
    };
  };

  const executeDispense = async () => {
    if (!selectedCustomer) return;

    try {
      setIsDispensing(true);
      const payload = await buildHospitalDispensePayload();
      if (!payload) return;

      const heldOrderId = getOriginalHeldDispenseOrderId();
      const result = await createHospitalSalesOrder({
        ...payload,
        ...(heldOrderId ? { draft_sales_order_name: heldOrderId } : {}),
      });
      const soName = result?.sales_order_name;
      if (!soName) {
        toast.error("Dispense failed. Sales Order was not created.");
        return;
      }
      const dispensedCartSignature = getCartSignature(cartItems);

      setLastDispensedLabelItems(await buildDispensedLabels(cartItems));

      setLastDispensedSalesOrder(soName);
      setLastDispensedCartSignature(dispensedCartSignature);
      setDispenseRemarks("");
      setDispenseRecordDate(null);
      clearHeldDispenseOrderCache();
      toast.success(`Dispensed successfully. Sales Order: ${soName}`);
    } catch (error) {
      toast.error(extractErrorFromException(error, "Failed to dispense items"));
    } finally {
      setIsDispensing(false);
    }
  };

  const handleDispense = async () => {
    let customer = selectedCustomer;
    if (!customer && isHospitalPharmacy && selectedPatient) {
      customer = await resolveCustomerForSelectedPatient();
    }
    if (!customer) {
      validateCustomer();
      return;
    }
    if (!isHospitalPharmacy) {
      if (!(await confirmCartBatchExpiry())) return;
      setShowPaymentDialog(true);
      return;
    }
    if (!validateHospitalDispense()) return;
    if (!(await confirmCartBatchExpiry())) return;
    setShowClinicalAppropriatenessConfirm(true);
  };

  const handleConfirmClinicalAppropriateness = () => {
    setShowClinicalAppropriatenessConfirm(false);
    void executeDispense();
  };

  const handleHoldDispenseOrder = async () => {
    let customer = selectedCustomer;
    if (!customer && isHospitalPharmacy && selectedPatient) {
      customer = await resolveCustomerForSelectedPatient();
    }
    if (!customer) {
      validateCustomer();
      return;
    }
    if (cartItems.length === 0) {
      toast.error("Add items to the cart before holding.");
      return;
    }
    if (!validateHospitalDispense()) return;
    if (!(await confirmCartBatchExpiry())) return;

    try {
      const payload = await buildHospitalDispensePayload();
      if (!payload) return;

      const heldOrderId = getOriginalHeldDispenseOrderId();
      const result = await createDraftHospitalSalesOrder({
        ...payload,
        ...(heldOrderId ? { draft_sales_order_name: heldOrderId } : {}),
      });
      const soName = result?.sales_order_name;
      if (!soName) {
        toast.error("Failed to hold dispense order.");
        return;
      }

      cacheHeldDispenseOrder({
        items: cartItems.map((item) => ({
          ...item,
          cartLineId: (item as CartItem & { cartLineId?: string }).cartLineId || item.id,
        })),
        timestamp: Date.now(),
        salesOrderId: soName,
        customer,
        patient: selectedPatient,
        lineDiscounts: itemDiscounts,
        dispenseRemarks,
        createdVisitRef,
        dispenseDate: dispenseRecordDate,
      });

      handleClearCart();
      toast.success(`Order held successfully. Sales Order: ${soName}`);
    } catch (error) {
      toast.error(extractErrorFromException(error, "Failed to hold dispense order"));
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildHoldOrderData = (): any => {
    if (!selectedCustomer) return null;
    const getLineKeyHold = (i: CartItem) => (i as CartItem & { cartLineId?: string }).cartLineId || i.id;
    return {
      items: cartItems.map((item) => {
        const lineKey = getLineKeyHold(item);
        const discount = itemDiscounts[lineKey] || itemDiscounts[item.id];
        return {
          ...item,
          batchNumber: (item as { batch_no?: string }).batch_no ?? discount?.batchNumber ?? null,
          serialNumber: (item as { serial_no?: string }).serial_no ?? discount?.serialNumber ?? null,
          dispensingLot:
            (item as { dispensing_lot?: string }).dispensing_lot
            ?? discount?.dispensingLot
            ?? null,
          dosage: discount?.dosage ?? item.dosage ?? null,
          prescriptionDosage: discount?.prescriptionDosage ?? item.prescriptionDosage ?? null,
          item_tax_template: (item as { item_tax_template?: string }).item_tax_template || null,
          additional_amount: (item as { additional_amount?: number }).additional_amount || 0,
        };
      }),
      customer: selectedCustomer,
      medicationOrder: (() => {
        const orders = new Set<string>();
        cartItems.forEach((item) => {
          const lineKey = getLineKeyHold(item);
          const discount = itemDiscounts[lineKey] || itemDiscounts[item.id];
          const orderName = discount?.medicationOrder;
          if (orderName) orders.add(orderName);
        });
        return Array.from(orders);
      })(),
      subtotal,
      total,
      appliedCoupons,
      itemDiscounts,
      totalItemDiscount,
      totalSavings: totalItemDiscount + couponDiscount,
      status: "held",
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleHoldOrder = async (orderData: any) => {
    if (!selectedCustomer) {
      toast.error(`Kindly select a ${party.lower}`);
      return;
    }

    try {
      // Creates a draft invoice and saves the order
      setShowPaymentDialog(false);

      const result = await createDraftSalesInvoice(orderData);

      if (result && result.success) {
        handleClearCart();
        toast.success("Draft invoice created and order held successfully!");
      } else {
        toast.error("Failed to create draft invoice");
      }
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error creating draft invoice:", error);
      const errorMessage = extractErrorFromException(error, "Failed to create draft invoice");
      toast.error(errorMessage);
    }
  };

  const handleClearCart = () => {
    if (cartItems.length === 0) return;

    // Use dedicated clear function if available
    if (onClearCart) {
      onClearCart();
      // When store-level clear is used, skip per-item removals.
      // Per-item removals can re-trigger pricing-rule async logic and momentarily repopulate items.
      // Clear local UI state too.
      setItemDiscounts({});
      setSelectedCustomer(null);
      setCustomerSearchQuery("");
      return;
    }

    // Fallback (when no onClearCart is provided): remove items individually.
    const itemsToRemove = [...cartItems];
    itemsToRemove.forEach((item) => {
      if (onRemoveItem) onRemoveItem(item.id);
    });

    // Clear applied coupons
    appliedCoupons.forEach((coupon) => {
      onRemoveCoupon(coupon.code);
    });

    // Clear item discounts
    setItemDiscounts({});

    // Reset customer selection
    setSelectedCustomer(null);
    setCustomerSearchQuery("");
  };

  const handlePostSaleComplete = useCallback(
    async (soldItems?: Array<{ itemCode: string; batchNo?: string }>) => {
      const items = soldItems ?? getSoldLineItems();
      handleClearCart();
      setLastDispensedSalesOrder(null);
      setLastDispensedLabelItems([]);
      setLastDispensedCartSignature(null);
      setDispenseRemarks("");
      setCreatedVisitRef(null);
      setDispenseRecordDate(null);
      try {
        await refreshStockOnly();
        if (items.length > 0) {
          await refreshSoldItemPickers(items);
        }
      } catch (error) {
        console.error("Failed to refresh stock after sale:", error);
      }
    },
    [getSoldLineItems, refreshStockOnly, refreshSoldItemPickers]
  );

  useEffect(() => {
    setAfterPosSaleComplete(handlePostSaleComplete);
    return () => setAfterPosSaleComplete(null);
  }, [handlePostSaleComplete, setAfterPosSaleComplete]);

  const getCustomerTypeIcon = (customer: Customer) => {
    switch (customer.type) {
      case "company":
        return <Building size={14} className="text-purple-600" />;
      case "walk-in":
        return <User size={14} className="text-gray-600" />;
      default:
        return <User size={14} className="text-blue-600" />;
    }
  };

  const toggleItemExpansion = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  useEffect(() => {
    if (isHospitalPharmacy) return;
    if (customers.length === 1 && !selectedCustomer && !isLoading) {
      const singleCustomer = customers[0];
      if (singleCustomer) {
        setSelectedCustomer(singleCustomer);
        setCustomerSearchQuery(singleCustomer.name);
      }
      setShowCustomerDropdown(false);

      // toast.info(`Automatically selected customer: ${singleCustomer.name}`);
    }
  }, [customers, selectedCustomer, isLoading, isHospitalPharmacy]);

  // Set default customer from POS profile when available (not in hospital pharmacy — user must choose patient)
  useEffect(() => {
    if (isHospitalPharmacy) return;

    if (posDetails?.default_customer && !selectedCustomer && !_posLoading && !userRemovedDefaultCustomer) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const defaultCustomer = posDetails.default_customer as any;

      // Use the new API to check if user has permission to access the default customer
      checkCustomerPermission(defaultCustomer.id).then((result) => {
        if (result.success && result.has_permission) {
          // Transform the default customer data to match the Customer interface
          const transformedCustomer: Customer = {
            id: defaultCustomer.id,
            name: defaultCustomer.name,
            email: defaultCustomer.email || '',
            phone: defaultCustomer.phone || '',
            type: (defaultCustomer.customer_type === "Company" ? "company" : "individual") as 'individual' | 'company',
            address: {
              street: "",
              city: "",
              state: "",
              zipCode: "",
              country: "Saudi Arabia",
            },
            loyaltyPoints: 0,
            totalSpent: 0,
            totalOrders: 0,
            preferredPaymentMethod: "Cash" as const,
            notes: "",
            tags: [],
            status: "active",
            createdAt: new Date().toISOString(),
            defaultCurrency: defaultCustomer.default_currency || undefined,
          };

          setSelectedCustomer(transformedCustomer);
          setCustomerSearchQuery(transformedCustomer.name);
          setShowCustomerDropdown(false);
        } else {
          console.log("User does not have permission to access default customer:", defaultCustomer.id, result);
          // Don't set the default customer if user doesn't have permission
          // The single customer auto-selection logic below will handle selecting the first available customer
        }
      }).catch((error) => {
        console.error("Error checking default customer permission:", error);
        // Don't set the default customer if there's an error checking permissions
      });
    }
  }, [posDetails, selectedCustomer, _posLoading, userRemovedDefaultCustomer, checkCustomerPermission, isHospitalPharmacy]);

  useEffect(() => {
    if (!cartItems.length) return;

    let cancelled = false;

    const fetchAndSetInfo = async () => {
      const batchesToAdd: Record<string, Awaited<ReturnType<typeof getBatches>>> = {};
      const serialsToAdd: Record<string, string[]> = {};

      for (const item of cartItems) {
        if (cancelled) return;

        const key = item.item_code || item.id;
        if (!key || key === "undefined") continue;

        if (!batchesToAdd[key]) {
          try {
            const batches = await getBatches(item.id);
            if (Array.isArray(batches)) batchesToAdd[key] = batches;
          } catch (err) {
            console.error("Error fetching batches", err);
          }
        }

        if (!useDispenseLot && !serialsToAdd[key]) {
          try {
            const serials = await getSerials(key);
            if (Array.isArray(serials)) serialsToAdd[key] = serials;
          } catch (err) {
            console.error("Error fetching serials", err);
          }
        }
      }

      if (cancelled) return;

      if (Object.keys(batchesToAdd).length > 0) {
        setItemBatches((prev) => ({ ...prev, ...batchesToAdd }));
      }
      if (Object.keys(serialsToAdd).length > 0) {
        setItemSerials((prev) => ({ ...prev, ...serialsToAdd }));
      }
    };

    void fetchAndSetInfo();

    return () => {
      cancelled = true;
    };
  }, [cartFetchSignature, useDispenseLot]);

  useEffect(() => {
    if (!useDispenseLot || !dispensingLotSignature) return;

    let cancelled = false;

    const fetchMissingDispensingLots = async () => {
      const items = cartItemsRef.current;
      const lotsToAdd: Record<string, DispensingLotOption[]> = {};
      const mapsToAdd: Record<string, Record<string, string>> = {};
      const keysToFetch = new Map<string, { itemCode: string; batchNo: string }>();

      for (const item of items) {
        const key = item.item_code || item.id;
        if (!key || key === "undefined") continue;

        const lineKey = getLineKey(item);
        const discount = itemDiscountsRef.current[lineKey];
        const batchNo =
          discount?.batchNumber?.trim() ||
          (item as CartItem & { batch_no?: string }).batch_no?.trim() ||
          "";
        const cacheKey = getDispensingLotCacheKey(key, batchNo);

        if (
          Object.prototype.hasOwnProperty.call(itemDispensingLotsRef.current, cacheKey) ||
          keysToFetch.has(cacheKey)
        ) {
          continue;
        }

        keysToFetch.set(cacheKey, { itemCode: key, batchNo });
      }

      for (const [cacheKey, { itemCode, batchNo }] of keysToFetch) {
        if (cancelled) return;

        try {
          const lots = await getDispensingLots(itemCode, batchNo || undefined);
          if (cancelled) return;
          lotsToAdd[cacheKey] = lots;
          mapsToAdd[cacheKey] = buildSerialLotMap(lots);
        } catch (err) {
          console.error("Error fetching dispensing lots", err);
        }
      }

      if (cancelled || Object.keys(lotsToAdd).length === 0) return;

      setItemDispensingLots((prev) => ({ ...prev, ...lotsToAdd }));
      setSerialLotMaps((prev) => ({ ...prev, ...mapsToAdd }));
    };

    void fetchMissingDispensingLots();

    return () => {
      cancelled = true;
    };
  }, [dispensingLotSignature, useDispenseLot]);

  // Listen for batch quantity updates from ProductProvider
  useEffect(() => {
    const handleBatchUpdate = (event: CustomEvent) => {
      const { updatedItems } = event.detail;

      setItemBatches(prevBatches => {
        const newBatches = { ...prevBatches };

        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        updatedItems.forEach(({ itemCode, batches }: { itemCode: string; batches: any[] }) => {
          if (itemCode && itemCode !== 'undefined') {
            newBatches[itemCode] = batches;
          } else {
            console.log(`OrderSummary: Skipping invalid itemCode: "${itemCode}"`);
          }
        });

        // Remove any undefined keys
        if (newBatches['undefined'] !== undefined) {
          delete newBatches['undefined'];
        }
        const undefinedKey = undefined as unknown as string;
        if (newBatches[undefinedKey] !== undefined) {
          delete newBatches[undefinedKey];
        }

        return newBatches;
      });
    };

    window.addEventListener('batchQuantitiesUpdated', handleBatchUpdate as EventListener);

    const handleDispensingLotsUpdate = (event: CustomEvent) => {
      const { updatedItems } = event.detail;

      setItemDispensingLots((prevLots) => {
        const newLots = { ...prevLots };

        updatedItems.forEach(
          ({
            itemCode,
            batchNo,
            lots,
          }: {
            itemCode: string;
            batchNo?: string;
            lots: DispensingLotOption[];
          }) => {
            if (itemCode && itemCode !== "undefined") {
              const cacheKey = getDispensingLotCacheKey(itemCode, batchNo);
              newLots[cacheKey] = lots;
              setDispensingLotsCache(itemCode, batchNo, lots);
            }
          }
        );

        return newLots;
      });

      setSerialLotMaps((prevMaps) => {
        const newMaps = { ...prevMaps };

        updatedItems.forEach(
          ({
            itemCode,
            batchNo,
            lots,
          }: {
            itemCode: string;
            batchNo?: string;
            lots: DispensingLotOption[];
          }) => {
            if (itemCode && itemCode !== "undefined") {
              const cacheKey = getDispensingLotCacheKey(itemCode, batchNo);
              newMaps[cacheKey] = buildSerialLotMap(lots);
            }
          }
        );

        return newMaps;
      });
    };

    window.addEventListener(
      "dispensingLotsUpdated",
      handleDispensingLotsUpdate as EventListener
    );

    // Listen for serial updates from ProductProvider
    const handleSerialUpdate = (event: CustomEvent) => {
      const { updatedItems } = event.detail;

      setItemSerials(prevSerials => {
        const newSerials = { ...prevSerials };

        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        updatedItems.forEach(({ itemCode, serials }: { itemCode: string; serials: string[] }) => {
          if (itemCode && itemCode !== 'undefined') {
            newSerials[itemCode] = serials;
          } else {
            console.log(`OrderSummary: Skipping invalid itemCode: "${itemCode}"`);
          }
        });

        // Remove any undefined keys
        if (newSerials['undefined'] !== undefined) {
          delete newSerials['undefined'];
        }
        const undefinedKey = undefined as unknown as string;
        if (newSerials[undefinedKey] !== undefined) {
          delete newSerials[undefinedKey];
        }

        return newSerials;
      });
    };

    window.addEventListener('serialsUpdated', handleSerialUpdate as EventListener);
//     const handleSetBatch = (event: CustomEvent) => {
//       const { itemCode, batchId, forLastAdded, lineKey: detailLineKey } = event.detail as { itemCode: string; batchId: string; forLastAdded?: boolean; lineKey?: string };
//       let lineKey: string | undefined;
//       if (detailLineKey) {
//         lineKey = detailLineKey;
//       } else {
//         const currentCart = useCartStore.getState().cartItems;
//         const matches = currentCart.filter(ci => (ci.item_code || ci.id) === itemCode);
//         const item = forLastAdded && matches.length > 0 ? matches[matches.length - 1] : matches[0];
//         lineKey = item ? getLineKey(item) : undefined;
//       }
//       if (lineKey) {
//         const selectedQty = itemBatches[itemCode]?.find(b => b.batch_id === batchId)?.qty || 0;
//         const base = itemDiscountsRef.current;
//         setItemDiscounts({
//           ...base,
//           [lineKey]: {
//             ...(base[lineKey] || { discountPercentage: 0, discountAmount: 0, batchNumber: '', serialNumber: '', availableQuantity: 0 }),
//             batchNumber: batchId || '',
//             availableQuantity: selectedQty,
//           }
//         });
//         // Build the full accumulated serial string first, then persist it
//       const existingSerials = new Set(
//         (itemDiscountsRef.current[lineKey]?.serialNumber || '').split(',').map(s => s.trim()).filter(Boolean)
//       );
//       if (serialNo) existingSerials.add(serialNo);
//       const fullSerialString = Array.from(existingSerials).join(',');
//       updateItemMetadata(lineKey, { serial_no: fullSerialString || undefined });
//             } else {
//               // Save pending, to be applied when item appears in cart
//               setPendingPreselect(prev => ({
//                 ...prev,
//                 [itemCode]: { ...(prev[itemCode] || {}), batchId, forLastAdded }
//               }));
//             }
//     }

//     const handleSetSerial = (event: CustomEvent) => {
//       const { itemCode, serialNo, forLastAdded, lineKey: detailLineKey } = event.detail as { itemCode: string; serialNo: string; forLastAdded?: boolean; lineKey?: string };
//       let lineKey: string | undefined;
//       if (detailLineKey) {
//         lineKey = detailLineKey;
//       } else {
//         const currentCart = useCartStore.getState().cartItems;
//         const matches = currentCart.filter(ci => (ci.item_code || ci.id) === itemCode);
//         const item = forLastAdded && matches.length > 0 ? matches[matches.length - 1] : matches[0];
//         lineKey = item ? getLineKey(item) : undefined;
//       }
//       if (lineKey) {
//         const base = itemDiscountsRef.current;
//         setItemDiscounts({
//           ...base,
//           [lineKey]: {
//             ...(base[lineKey] || { discountPercentage: 0, discountAmount: 0, batchNumber: '', serialNumber: '', availableQuantity: 0 }),
//             // serialNumber: serialNo || '',
//             serialNumber: (() => {
//               const existing = new Set(
//                 (base[lineKey]?.serialNumber || '').split(',').map(s => s.trim()).filter(Boolean)
//               );
//               if (serialNo) existing.add(serialNo);
//               return Array.from(existing).join(',');
//             })(),
//           }
//         });
//         const existingPending = new Set(
//   (base[lineKey]?.serialNumber || '').split(',').map(s => s.trim()).filter(Boolean)
// );
// if (pending.serialNo) existingPending.add(pending.serialNo);
// updateItemMetadata(lineKey, { serial_no: Array.from(existingPending).join(',') || undefined })
//         setItemSerials(prev => {
//           const key = itemCode;
//           const existing = new Set(prev[key] || []);
//           if (!existing.has(serialNo)) {
//             return { ...prev, [key]: [...existing, serialNo] as string[] };
//           }
//           return prev;
//         });
//       } else {
//         setPendingPreselect(prev => ({
//           ...prev,
//           [itemCode]: { ...(prev[itemCode] || {}), serialNo, forLastAdded }
//         }));
//       }
//     }

const handleSetBatch = (event: CustomEvent) => {
  const { itemCode, batchId, forLastAdded, lineKey: detailLineKey } = event.detail as { itemCode: string; batchId: string; forLastAdded?: boolean; lineKey?: string };
  let lineKey: string | undefined;
  if (detailLineKey) {
    lineKey = detailLineKey;
  } else {
    const currentCart = useCartStore.getState().cartItems;
    const matches = currentCart.filter(ci => (ci.item_code || ci.id) === itemCode);
    const item = forLastAdded && matches.length > 0 ? matches[matches.length - 1] : matches[0];
    lineKey = item ? getLineKey(item) : undefined;
  }
  if (lineKey) {
    const selectedQty = itemBatches[itemCode]?.find(b => b.batch_id === batchId)?.qty || 0;
    const base = itemDiscountsRef.current;
    setItemDiscounts({
      ...base,
      [lineKey]: {
        ...(base[lineKey] || {
          discountPercentage: 0,
          discountAmount: 0,
          batchNumber: "",
          serialNumber: "",
          availableQuantity: 0,
        }),
        batchNumber: batchId || "",
        availableQuantity: selectedQty,
        serialNumber: "",
      },
    });
    updateItemMetadata(lineKey, {
      batch_no: batchId || undefined,
      serial_no: undefined,
      dispensing_lot: undefined,
    });
    const expiry = itemBatches[itemCode]?.find((b) => b.batch_id === batchId)?.expiry_date;
    rememberBatchExpiry(batchId, expiry);
    const cartLine = useCartStore.getState().cartItems.find(
      (ci) => getLineKey(ci) === lineKey
    );
    const itemName = cartLine?.name || itemCode;
    if (expiry) {
      warnOnBatchExpirySelection(itemName, batchId, expiry);
    } else if (batchId) {
      void fetchBatchExpiryIfNeeded(batchId, itemCode, itemName);
    }
  } else {
    setPendingPreselect(prev => ({
      ...prev,
      [itemCode]: { ...(prev[itemCode] || {}), batchId, forLastAdded }
    }));
  }
}

const handleSetSerial = (event: CustomEvent) => {
  const { itemCode, serialNo, forLastAdded, lineKey: detailLineKey, dispensingLot } = event.detail as {
    itemCode: string;
    serialNo: string;
    forLastAdded?: boolean;
    lineKey?: string;
    dispensingLot?: string;
  };
  let lineKey: string | undefined;
  if (detailLineKey) {
    lineKey = detailLineKey;
  } else {
    const currentCart = useCartStore.getState().cartItems;
    const matches = currentCart.filter(ci => (ci.item_code || ci.id) === itemCode);
    const item = forLastAdded && matches.length > 0 ? matches[matches.length - 1] : matches[0];
    lineKey = item ? getLineKey(item) : undefined;
  }
  if (lineKey) {
    const base = itemDiscountsRef.current;
    // Accumulate serials (comma-separated)
    const accumulated = (() => {
      const existing = new Set(
        (base[lineKey]?.serialNumber || '').split(',').map(s => s.trim()).filter(Boolean)
      );
      if (serialNo) existing.add(serialNo);
      return Array.from(existing).join(',');
    })();
    const batchNo = base[lineKey]?.batchNumber || "";
    const lotMap =
      serialLotMapsRef.current[getDispensingLotCacheKey(itemCode, batchNo)] ||
      serialLotMapsRef.current[itemCode] ||
      {};
    const lotNames = Array.from(
      new Set(
        accumulated
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => lotMap[s] || (dispensingLot && s === serialNo ? dispensingLot : undefined))
          .filter(Boolean) as string[]
      )
    );
    const lotsValue = joinDispensingLotNames(lotNames);

    setItemDiscounts({
      ...base,
      [lineKey]: {
        ...(base[lineKey] || { discountPercentage: 0, discountAmount: 0, batchNumber: '', serialNumber: '', availableQuantity: 0 }),
        serialNumber: accumulated,
        dispensingLot: lotsValue || undefined,
      },
    });
    updateItemMetadata(lineKey, {
      dispensing_lot: lotsValue || undefined,
    });
    setItemSerials(prev => {
      const existing = new Set(prev[itemCode] || []);
      if (!existing.has(serialNo)) {
        return { ...prev, [itemCode]: [...existing, serialNo] as string[] };
      }
      return prev;
    });
  } else {
    setPendingPreselect(prev => ({
      ...prev,
      [itemCode]: { ...(prev[itemCode] || {}), serialNo, forLastAdded }
    }));
  }
}
    window.addEventListener('cart:setBatchForItem', handleSetBatch as EventListener)
    window.addEventListener('cart:setSerialForItem', handleSetSerial as EventListener)

    return () => {
      window.removeEventListener('batchQuantitiesUpdated', handleBatchUpdate as EventListener);
      window.removeEventListener(
        "dispensingLotsUpdated",
        handleDispensingLotsUpdate as EventListener
      );
      window.removeEventListener('serialsUpdated', handleSerialUpdate as EventListener);
      window.removeEventListener('cart:setBatchForItem', handleSetBatch as EventListener)
      window.removeEventListener('cart:setSerialForItem', handleSetSerial as EventListener)
    };
  }, [cartItems, itemBatches, getLineKey, updateItemMetadata, refreshDispensingLotsForItem, isHospitalPharmacy, rememberBatchExpiry, fetchBatchExpiryIfNeeded]);

  useEffect(() => {
    if (!isHospitalPharmacy) return;

    cartItems.forEach((item) => {
      const lineKey = getLineKey(item);
      const itemCode = item.item_code || item.id;
      const batchNo =
        itemDiscounts[lineKey]?.batchNumber?.trim() ||
        (item as CartItem & { batch_no?: string }).batch_no?.trim() ||
        "";
      if (batchNo) {
        void fetchBatchExpiryIfNeeded(batchNo, itemCode);
      }
    });
  }, [cartItems, itemDiscounts, isHospitalPharmacy, getLineKey, fetchBatchExpiryIfNeeded]);

  // Apply any pending pre-selections when cart items change
  useEffect(() => {
    if (!cartItems.length) return
    const nextPending = { ...pendingPreselect }
    Object.keys(nextPending).forEach(itemCode => {
      const pending = nextPending[itemCode]
      if (!pending) return
      const matches = cartItems.filter(ci => (ci.item_code || ci.id) === itemCode)
      const target = (pending as { forLastAdded?: boolean }).forLastAdded && matches.length > 0
        ? matches[matches.length - 1]
        : matches[0]
      if (target) {
        const lineKey = getLineKey(target)
        const base = itemDiscountsRef.current
        if (pending.batchId) {
          const selectedQty = itemBatches[itemCode]?.find(b => b.batch_id === pending.batchId)?.qty || 0
          setItemDiscounts({
            ...base,
            [lineKey]: {
              ...(base[lineKey] || { discountPercentage: 0, discountAmount: 0, batchNumber: '', serialNumber: '', availableQuantity: 0 }),
              batchNumber: pending.batchId || '',
              availableQuantity: selectedQty,
            }
          })
          updateItemMetadata(lineKey, { batch_no: pending.batchId || undefined })
        }
        if (pending.serialNo) {
          const accumulated = (() => {
            const existing = new Set(
              (base[lineKey]?.serialNumber || '').split(',').map(s => s.trim()).filter(Boolean)
            );
            if (pending.serialNo) existing.add(pending.serialNo);
            return Array.from(existing).join(',');
          })();
          const pendingBatch =
            pending.batchId ||
            base[lineKey]?.batchNumber ||
            (target as CartItem & { batch_no?: string }).batch_no ||
            "";
          const lotMap =
            serialLotMapsRef.current[
              getDispensingLotCacheKey(itemCode, pendingBatch)
            ] ||
            serialLotMapsRef.current[itemCode] ||
            {};
          const lotNames = Array.from(
            new Set(
              accumulated
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => lotMap[s])
                .filter(Boolean) as string[]
            )
          );
          const lotsValue = joinDispensingLotNames(lotNames);
          setItemDiscounts({
            ...base,
            [lineKey]: {
              ...(base[lineKey] || { discountPercentage: 0, discountAmount: 0, batchNumber: '', serialNumber: '', availableQuantity: 0 }),
              serialNumber: accumulated,
              dispensingLot: lotsValue || undefined,
            }
          })
          updateItemMetadata(lineKey, {
            dispensing_lot: lotsValue || undefined,
          })
          setItemSerials(prev => {
            const existing = new Set(prev[itemCode] || [])
            if (!existing.has(pending.serialNo!)) {
              return { ...prev, [itemCode]: [...existing, pending.serialNo!] as string[] }
            }
            return prev
          })
        }
        delete nextPending[itemCode]
      }
    })
    if (Object.keys(nextPending).length !== Object.keys(pendingPreselect).length) {
      setPendingPreselect(nextPending)
    }
  }, [cartItems, itemBatches, pendingPreselect, getLineKey, updateItemMetadata])

  return (
    <div
      className={`${
        isMobile ? "h-full flex flex-col" : "h-full flex flex-col"
      } bg-white dark:bg-gray-800 ${
        !isMobile ? "border-l" : ""
      } border-gray-200 dark:border-gray-700`}
    >
      {/* Header */}
      {!isMobile && (
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          {/* Customer Search */}
          <div className="relative">
            <div className="flex items-center">
              <div className="relative flex-1" ref={customerSearchContainerRef}>
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder={
                    isHospitalPharmacy
                      ? "Search patients... (name, file no, ID number, or mobile)"
                      : isPharmacy
                      ? "Search customers or patients... (name, email, phone, patient ID, or file no)"
                      : "Search customers... (name, email, or phone)"
                  }
                  value={customerSearchQuery}
                  onChange={(e) => {
                    setCustomerSearchQuery(e.target.value);
                    // Always show dropdown when typing
                    setShowCustomerDropdown(true);
                  }}
                  onKeyDown={handleCustomerSearchKeyDown} // Add this line
                  onFocus={() => {
                    setShowCustomerDropdown(true);
                  }}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />

                {/* Customer/Patient Dropdown */}
                {showCustomerDropdown && (
                  (!isHospitalPharmacy && filteredCustomers.length > 0) ||
                  ((isPharmacy || isHospitalPharmacy) && visiblePatients.length > 0)
                ) && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                    {/* Customers (retail / pharmacy — hospital is patient-only search) */}
                    {!isHospitalPharmacy && filteredCustomers.slice(0, 8).map((customer) => {
                      // Check if this customer also exists as a patient (patient_name matches customer name)
                      const matchingPatient = isPharmacy ? patients.find(
                        p => (p.patient_name || p.name).toLowerCase() === customer.name.toLowerCase()
                      ) : null;
                      const isAlsoPatient = !!matchingPatient;
                      
                      return (
                        <button
                          key={customer.id}
                          onClick={() => {
                            // If customer is also a patient, show medication orders modal
                            if (isAlsoPatient && matchingPatient) {
                              handlePatientSelect(matchingPatient);
                            } else {
                              handleCustomerSelect(customer);
                            }
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700"
                        >
                          <div className="flex items-center space-x-2">
                            {getCustomerTypeIcon(customer)}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                                  {customer.name}
                                </div>
                                {isAlsoPatient && !isHospitalPharmacy && (
                                  <span className="px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                    Patient
                                  </span>
                                )}
                                {isHospitalPharmacy && (
                                  <span className="px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                    Patient
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                 {customer.phone} • {customer.email}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    
                    {/* Patients (pharmacy / hospital mode) */}
                    {(isPharmacy || isHospitalPharmacy) && visiblePatients.length > 0 && (
                      <>
                        {filteredCustomers.length > 0 && !isHospitalPharmacy && (
                          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                            Patients (without customer record)
                          </div>
                        )}
                        {visiblePatients.slice(0, 8).map((patient) => (
                          <button
                            key={patient.name}
                            onClick={() => handlePatientSelect(patient)}
                            className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                          >
                            <PatientSearchDropdownOption patient={patient} />
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowAddCustomerModal(true)}
                className="ml-2 p-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
                title={`Add New ${party.singular}`}
              >
                <UserPlus size={16} />
              </button>
            </div>

            {/* Selected Customer / Patient Display - show when either is set so Pill (orders) + X always visible for patient */}
            {(selectedCustomer || selectedPatient) && (
              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedCustomer ? getCustomerTypeIcon(selectedCustomer) : <User className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                    <span className="font-medium text-gray-900 dark:text-white text-sm truncate">
                      {getSelectedPartyDisplayName(selectedPatient, selectedCustomer)}
                    </span>
                  </div>
                  <div className="flex-1 flex justify-center items-center min-w-0">
                    {(() => {
                      const points = (customerStats?.loyalty_points ?? selectedCustomer?.loyaltyPoints ?? 0);
                      if (points <= 0) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            setRedeemPointsInput(String(redeemLoyaltyPoints ?? Math.round(points)));
                            setShowRedeemLoyaltyModal(true);
                          }}
                          className="px-3 py-1.5 text-xs font-medium bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
                          title="Redeem loyalty points"
                        >
                          Redeem {Math.round(points)}
                        </button>
                      );
                    })()}
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    {/* Pill: view medication orders - always show when customer/patient selected in pharmacy so it survives refresh */}
                    {(selectedPatient || (selectedCustomer && (isPharmacy || isHospitalPharmacy))) ? (
                      <>
                      {isHospitalPharmacy ? (
                        <button
                          onClick={() => void openPatientDetailsModal()}
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/40 dark:hover:text-slate-300 transition-colors"
                          title="Patient details & documents"
                        >
                          <User size={16} />
                        </button>
                      ) : null}
                      <button
                        onClick={openMedicationOrdersModal}
                        className="p-1.5 rounded-md text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors"
                        title="View medication orders"
                      >
                        <Pill size={16} />
                    </button>
                    </>
                  ) : null}
                    <button
                      onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerSearchQuery("");
                        setUserRemovedDefaultCustomer(true);
                        setMedicationOrders([]);
                        setMedicationOrderHistory([]);
                        setLegacyDispensedMedications([]);
                        setSelectedOrders(new Set());
                        setSelectedHistoryItems(new Set());
                      }}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                  {selectedPatient && getPatientSecondaryLabel(selectedPatient) ? (
                    <span>{getPatientSecondaryLabel(selectedPatient)}</span>
                  ) : null}
                  {selectedPatient && getPatientSecondaryLabel(selectedPatient) && selectedCustomer?.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" ? (
                    <span className="mx-2">•</span>
                  ) : null}
                  {selectedCustomer && selectedCustomer.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" && (
                    <span>{selectedCustomer.phone}</span>
                  )}
                  {selectedCustomer && selectedCustomer.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" && (customerStats?.total_orders || 0) > 0 && (
                    <span className="mx-2">•</span>
                  )}
                  {selectedCustomer && (customerStats?.total_orders || 0) > 0 && (
                    <span>{customerStats?.total_orders || 0} {party.historyLabel}</span>
                  )}
                  {!selectedPatient && selectedCustomer && (!selectedCustomer.phone || selectedCustomer.phone === "N/A" || selectedCustomer.phone.trim() === "") && (customerStats?.total_orders || 0) === 0 && (
                    <span className="text-gray-400 italic">No additional info</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Customer Search */}

      {isMobile && (
        <div className="flex-shrink-0 p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center space-x-2">
            <div className="relative flex-1" ref={customerSearchContainerRef}>
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder={
                  isHospitalPharmacy
                      ? "Search patients... (name, file no, ID number, or mobile)"
                    : "Search customers... (name, email, or phone)"
                }
                value={customerSearchQuery}
                onChange={(e) => {
                  setCustomerSearchQuery(e.target.value);
                  setShowCustomerDropdown(e.target.value.length > 0);
                }}
                onKeyDown={handleCustomerSearchKeyDown}
                onFocus={() => setShowCustomerDropdown(true)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />

              {/* ADD THIS MISSING DROPDOWN - This was missing in mobile version */}
              {showCustomerDropdown && (
                (!isHospitalPharmacy && filteredCustomers.length > 0) ||
                ((isPharmacy || isHospitalPharmacy) && visiblePatients.length > 0)
              ) && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {!isHospitalPharmacy && filteredCustomers.slice(0, 8).map((customer) => {
                    const matchingPatient = (isPharmacy || isHospitalPharmacy) ? patients.find(
                      p => (p.patient_name || p.name).toLowerCase() === customer.name.toLowerCase()
                    ) : null;
                    const isAlsoPatient = !!matchingPatient;

                    return (
                    <button
                      key={customer.id}
                      onClick={() => {
                        if (isAlsoPatient && matchingPatient) {
                          handlePatientSelect(matchingPatient);
                        } else {
                          handleCustomerSelect(customer);
                        }
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                    >
                      <div className="flex items-center space-x-2">
                        {getCustomerTypeIcon(customer)}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                            {customer.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {customer.email} • {customer.phone}
                          </div>
                        </div>
                      </div>
                    </button>
                    );
                  })}
                  {(isPharmacy || isHospitalPharmacy) && visiblePatients.length > 0 && visiblePatients
                    .slice(0, 8)
                    .map((patient) => (
                      <button
                        key={patient.name}
                        onClick={() => handlePatientSelect(patient)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                      >
                        <PatientSearchDropdownOption patient={patient} />
                      </button>
                    ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowAddCustomerModal(true)}
              className="p-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
              title={`Add New ${party.singular}`}
            >
              <UserPlus size={16} />
            </button>
          </div>

          {/* Selected Customer / Patient - show when either is set so Pill (orders) + X visible for patient */}
          {(selectedCustomer || selectedPatient) && (
            <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {selectedCustomer ? getCustomerTypeIcon(selectedCustomer) : <User className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                  <span className="font-medium text-gray-900 dark:text-white text-sm truncate">
                    {getSelectedPartyDisplayName(selectedPatient, selectedCustomer)}
                  </span>
                </div>
                <div className="flex-1 flex justify-center items-center min-w-0">
                  {(() => {
                    const points = (customerStats?.loyalty_points ?? selectedCustomer?.loyaltyPoints ?? 0);
                    if (points <= 0) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setRedeemPointsInput(String(redeemLoyaltyPoints ?? Math.round(points)));
                          setShowRedeemLoyaltyModal(true);
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
                        title="Redeem loyalty points"
                      >
                        Redeem {Math.round(points)}
                      </button>
                    );
                  })()}
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  {/* Pill: view medication orders - always show when customer/patient selected in pharmacy so it survives refresh */}
                  {(selectedPatient || (selectedCustomer && (isPharmacy || isHospitalPharmacy))) ? (
                    <>
                      {isHospitalPharmacy ? (
                        <button
                          onClick={() => void openPatientDetailsModal()}
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/40 dark:hover:text-slate-300 transition-colors"
                          title="Patient details & documents"
                        >
                          <User size={18} />
                        </button>
                      ) : null}
                      <button
                        onClick={openMedicationOrdersModal}
                        className="p-1.5 rounded-md text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors"
                        title="View medication orders"
                      >
                        <Pill size={18} />
                      </button>
                    </>
                  ) : null}
                  <button
                    onClick={() => {
                      setSelectedCustomer(null);
                      setCustomerSearchQuery("");
                      setUserRemovedDefaultCustomer(true);
                      setMedicationOrders([]);
                      setMedicationOrderHistory([]);
                      setLegacyDispensedMedications([]);
                      setSelectedOrders(new Set());
                      setSelectedHistoryItems(new Set());
                      setShowCustomerDropdown(false);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                {selectedPatient && getPatientSecondaryLabel(selectedPatient) ? (
                  <span>{getPatientSecondaryLabel(selectedPatient)}</span>
                ) : null}
                {selectedPatient && getPatientSecondaryLabel(selectedPatient) && selectedCustomer?.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" ? (
                  <span className="mx-2">•</span>
                ) : null}
                {selectedCustomer && selectedCustomer.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" && (
                  <span>{selectedCustomer.phone}</span>
                )}
                {selectedCustomer && selectedCustomer.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" && (customerStats?.total_orders || 0) > 0 && (
                  <span className="mx-2">•</span>
                )}
                {selectedCustomer && (customerStats?.total_orders || 0) > 0 && (
                  <span>{customerStats?.total_orders || 0} orders</span>
                )}
                {!selectedPatient && selectedCustomer && (!selectedCustomer.phone || selectedCustomer.phone === "N/A" || selectedCustomer.phone.trim() === "") && (customerStats?.total_orders || 0) === 0 && (
                  <span className="text-gray-400 italic">No additional info</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cart Items - Scrollable on Mobile */}
      <div
        className={`${
          isMobile
            ? "flex-1 overflow-y-auto custom-scrollbar p-4"
            : "flex-1 overflow-y-auto p-6 cart-scroll"
        }`}
      >
        <div className="space-y-4">
          {cartItems.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">🛒</div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Your cart is empty
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Add some items to get started!
              </p>
            </div>
          ) : (
            cartItems.map((item) => {
              const lineKey = getLineKey(item);
              const isServiceItem = !!(item as CartItem & { is_pharmacy_service?: boolean }).is_pharmacy_service;
              const duplicateLineEnabled = !isServiceItem;
              const showAddService = isHospitalPharmacy && !isServiceItem;
              const showPinkReference = isHospitalPharmacy && !!(item as CartItem).is_pink;
              const row5FieldCount = [
                isItemTaxTemplateMode && !isHospitalPharmacy,
                showPinkReference,
                showAddService,
                isAllowAdditionalAmounts && !isHospitalPharmacy,
              ].filter(Boolean).length;
              const discountedPrice = getDiscountedPrice(item);
              const originalTotal = item.price * item.quantity;
              const discountedTotal = discountedPrice * item.quantity;
              
                const cartItemBatch = (item as { batch_no?: string }).batch_no;
                const cartItemSerial = (item as { serial_no?: string }).serial_no;

                // Merge cart-persisted serials with locally accumulated serials (both comma-separated)
                const localSerialNumber = itemDiscounts[lineKey]?.serialNumber || "";
                const mergedSerialNumber = (() => {
                  const merged = new Set([
                    ...localSerialNumber.split(",").map(s => s.trim()).filter(Boolean),
                    ...(cartItemSerial ? cartItemSerial.split(",").map(s => s.trim()).filter(Boolean) : []),
                  ]);
                  return Array.from(merged).join(",");
                })();

                const itemDiscount = {
                  discountPercentage: 0,
                  discountAmount: 0,
                  batchNumber: "",
                  serialNumber: "",
                  availableQuantity: 150,
                  prescriptionDosage: "",
                  dosage: "",
                  ...(itemDiscounts[item.id] || {}),
                  ...(itemDiscounts[lineKey] || {}),
                  // Persisted batch survives refresh
                  ...(cartItemBatch !== undefined && cartItemBatch !== "" ? { batchNumber: cartItemBatch } : {}),
                  // Merge persisted + local serials instead of overwriting
                  ...(mergedSerialNumber ? { serialNumber: mergedSerialNumber } : {}),
                };
                const itemCode = item.item_code || item.id;
                const batchExpiryLabel =
                  isHospitalPharmacy && itemDiscount.batchNumber
                    ? formatBatchExpiryLabel(
                        resolveBatchExpiry(itemCode, itemDiscount.batchNumber)
                      )
                    : null;

              return (
                <div
                  key={lineKey}
                  className={`${
                    isMobile
                      ? "bg-gray-50 dark:bg-gray-700 rounded-lg overflow-hidden"
                      : ""
                  }`}
                >
                  {/* Main item row */}
                  <div
                    className={`flex items-center ${isMobile ? "p-3" : "py-2"}`}
                  >
                    {/* Expand/Collapse Arrow */}
                    <div className="flex-shrink-0 mr-2">
                      <button
                        onClick={() => toggleItemExpansion(lineKey)}
                        className={`${
                          isMobile ? "w-5 h-5" : "w-5 h-5"
                        } rounded-full bg-gray-100 dark:bg-gray-600 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-500 transition-all duration-200`}
                        title="Show/Hide Details"
                      >
                        <svg
                          className={`${
                            isMobile ? "w-3 h-3" : "w-4 h-4"
                          } text-beveren-500 dark:text-gray-400 transform transition-transform duration-200 ${
                            expandedItems.has(lineKey) ? "rotate-90" : ""
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    </div>

                    {/* Product Image - Only show if image exists */}
                    {item.image && (
                      <div className="flex-shrink-0">
                        <img
                          src={item.image}
                          alt={item.name}
                          className={`${
                            isMobile ? "w-16 h-16" : "w-12 h-12"
                          } rounded-lg object-cover`}
                          crossOrigin="anonymous"
                        />
                      </div>
                    )}

                    {/* Product Info */}
                    <div className="flex-1 min-w-0 px-3">
                      <h4
                        className={`font-semibold text-gray-900 dark:text-white ${
                          isMobile ? "text-base" : "text-sm"
                        } truncate`}
                      >
                        {item.name}
                      </h4>
                      <p
                        className={`text-gray-500 dark:text-gray-400 capitalize font-medium ${
                          isMobile ? "text-sm" : "text-xs"
                        }`}
                      >
                        {item.category}
                      </p>
                      <div className={`${isMobile ? "text-base" : "text-sm"}`}>
                        {discountedPrice < item.price ? (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-400 line-through text-xs">
                              {currency_symbol}
                              {item.price.toFixed(3)}
                            </span>

                            <span className="text-beveren-600 dark:text-beveren-400 font-semibold">
                              {currency_symbol}
                              {discountedPrice.toFixed(3)}
                            </span>
                          </div>
                        ) : (
                          <div className="text-beveren-600 dark:text-beveren-400 font-semibold">
                            {currency_symbol}
                            {item.price.toFixed(3)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quantity Controls - Fixed Width Container */}
                    <div className="flex-shrink-0 flex items-center ml-10 space-x-1 min-w-[70px] justify-center">
                      <button
                        onClick={() =>
                          onUpdateQuantity(lineKey, item.quantity - 1)
                        }
                        className={`${
                          isMobile ? "w-8 h-8" : "w-5 h-5"
                        } rounded-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors`}
                      >
                        <Minus
                          size={isMobile ? 16 : 14}
                          className="text-gray-600 dark:text-gray-400"
                        />
                      </button>
                      <span
                        className={`${
                          isMobile ? "w-10" : "w-8"
                        } text-center font-semibold text-gray-900 dark:text-white text-sm`}
                      >
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          onUpdateQuantity(lineKey, item.quantity + 1)
                        }
                        className={`${
                          isMobile ? "w-8 h-8" : "w-7 h-7"
                        } rounded-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors`}
                      >
                        <Plus size={isMobile ? 16 : 14} className="text-blue-600 dark:text-blue-400" />
                      </button>
                    </div>

                    {/* Total Price */}
                    <div className="flex-shrink-0 text-right min-w-[80px] px-2">
                      {discountedTotal < originalTotal ? (
                        <div>
                          <p className="text-gray-400 line-through text-xs">
                            {currency_symbol}
                            {originalTotal.toFixed(3)}
                          </p>
                          <p
                            className={`text-beveren-600 dark:text-beveren-400 font-semibold ${
                              isMobile ? "text-base" : "text-sm"
                            }`}
                          >
                            {currency_symbol}
                            {discountedTotal.toFixed(3)}
                          </p>
                        </div>
                      ) : (
                        <p
                          className={`text-beveren-600 dark:text-beveren-400 font-semibold ${
                            isMobile ? "text-base" : "text-sm"
                          }`}
                        >
                          {currency_symbol}
                          {discountedTotal.toFixed(3)}
                        </p>
                      )}
                    </div>

                    {duplicateLineEnabled && (
                      <div className="flex-shrink-0 ml-1">
                        <button
                          type="button"
                          onClick={() => void handleAddDuplicateLine(item)}
                          className={`${
                            isMobile ? "w-8 h-8" : "w-6 h-6"
                          } rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors`}
                          title="Add line (separate batch/serial)"
                        >
                          <CopyPlus
                            size={isMobile ? 16 : 12}
                            className="text-emerald-600 dark:text-emerald-400"
                          />
                        </button>
                      </div>
                    )}

                    {/* Remove Button */}
                    <div className="flex-shrink-0 ml-2">
                      <button
                        onClick={() =>
                          onRemoveItem
                            ? onRemoveItem(lineKey)
                            : onUpdateQuantity(lineKey, 0)
                        }
                        className={`${
                          isMobile ? "w-8 h-8" : "w-6 h-6"
                        } rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800 hover:text-red-600 dark:hover:text-red-400 transition-colors`}
                        title="Remove item"
                      >
                        <X size={isMobile ? 16 : 12} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details Section */}
                  {expandedItems.has(lineKey) && (
                    <div
                      className={`border-t border-gray-200 dark:border-gray-600 ${
                        isMobile ? "px-3 pb-3" : "px-6 py-3 ml-7"
                      } bg-gray-25 dark:bg-gray-750`}
                    >
                      <div className="w-full">
                        {/* Row 1: Quantity | UOM (or Rate for service items) */}
                        <div className="grid grid-cols-2 gap-3 mb-3 items-stretch">
                          <div className={cartFieldCellClass}>
                            <label className={cartFieldLabelClass}>
                              Quantity
                            </label>
                            <QuantityInput
                              item={item}
                              onUpdateQuantity={(_id, qty) => onUpdateQuantity(lineKey, qty)}
                              isMobile={isMobile}
                            />
                          </div>
                          {isServiceItem ? (
                            <div className={cartFieldCellClass}>
                              <label className={cartFieldLabelClass}>
                                {isHospitalPharmacy ? "Amount" : "Rate"}
                              </label>
                              <ServiceRateInput
                                lineKey={lineKey}
                                price={item.price}
                                onRateChange={(key, rate) =>
                                  updateItemMetadata(key, { price: rate, rate_edited: true })
                                }
                                isMobile={isMobile}
                              />
                            </div>
                          ) : (
                            <div className={cartFieldCellClass}>
                              <label className={cartFieldLabelClass}>
                                UOM
                              </label>
                              <UOMSelectField
                                item={item}
                                onUOMChange={(_, uom, price, conversionFactor) =>
                                  handleUOMChange(lineKey, uom, price, conversionFactor)
                                }
                                isMobile={isMobile}
                                selectedCustomer={selectedCustomer}
                              />
                            </div>
                          )}
                        </div>

                        {allowUserEditRate && !isServiceItem && (
                          <div className="grid grid-cols-2 gap-3 mb-3 items-stretch">
                            <div className={cartFieldCellClass}>
                              <label className={cartFieldLabelClass}>Rate</label>
                              <ServiceRateInput
                                lineKey={lineKey}
                                price={item.price}
                                onRateChange={(key, rate) =>
                                  updateItemMetadata(key, { price: rate, rate_edited: true })
                                }
                                isMobile={isMobile}
                              />
                            </div>
                          </div>
                        )}

                        {/* Row 2: Discount Amount | Discount (%) — hidden in hospital pharmacy */}
                        {!isHospitalPharmacy && (
                        <div className="grid grid-cols-2 gap-3 mb-3 items-stretch">
                          <div className={cartFieldCellClass}>
                            <label className={cartFieldLabelClass}>
                              Discount Amount
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={itemDiscount.discountAmount || ""}
                              onChange={(e) =>
                                updateItemDiscount(
                                  lineKey,
                                  "discountAmount",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              placeholder="0.00"
                              className={cartFieldInputClass}
                            />
                          </div>
                          <div className={cartFieldCellClass}>
                            <label className={cartFieldLabelClass}>
                              Discount (%)
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              value={itemDiscount.discountPercentage || ""}
                              onChange={(e) =>
                                updateItemDiscount(
                                  lineKey,
                                  "discountPercentage",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              placeholder="0.0"
                              className={cartFieldInputClass}
                            />
                          </div>
                        </div>
                        )}

                        {/* Row 3: Batch | Serial No */}
                        {!isServiceItem && (
                        <div className="grid grid-cols-2 gap-3 mb-3 items-stretch">
                          <div className={cartFieldCellClass}>
                            <label className={cartFieldLabelClass}>
                              <span className="flex items-center gap-2 flex-wrap">
                                <span>Batch</span>
                                {batchExpiryLabel && (
                                  <span className="text-[10px] font-normal normal-case tracking-normal text-gray-500 dark:text-gray-400">
                                    Exp: {batchExpiryLabel}
                                  </span>
                                )}
                              </span>
                            </label>
                            <BatchSelectField
                              itemId={lineKey}
                              itemCode={itemCode}
                              options={itemBatches[itemCode] || []}
                              value={itemDiscount.batchNumber || ""}
                              onChange={(selectedBatch, selectedQty) => {
                                updateItemDiscount(lineKey, "batchNumber", selectedBatch)
                                updateItemDiscount(lineKey, "availableQuantity", selectedQty)
                                updateItemDiscount(lineKey, "serialNumber", "")
                                updateItemMetadata(lineKey, {
                                  batch_no: selectedBatch || undefined,
                                  serial_no: undefined,
                                  dispensing_lot: undefined,
                                })
                                if (selectedBatch) {
                                  const expiry = itemBatches[itemCode]?.find(
                                    (b) => b.batch_id === selectedBatch
                                  )?.expiry_date;
                                  rememberBatchExpiry(selectedBatch, expiry);
                                  if (expiry) {
                                    warnOnBatchExpirySelection(item.name || itemCode, selectedBatch, expiry);
                                  } else {
                                    void fetchBatchExpiryIfNeeded(
                                      selectedBatch,
                                      itemCode,
                                      item.name || itemCode
                                    );
                                  }
                                }
                              }}
                              isMobile={isMobile}
                            />
                          </div>
                          <div className={cartFieldCellClass}>
                            <label className={cartFieldLabelClass}>
                              {useDispenseLot ? "Dispensing Lot" : "Serial No"}
                            </label>
                            <SerialSelectField
                              itemId={lineKey}
                              itemCode={item.item_code || item.id}
                              options={getSerialSelectOptions(item)}
                              value={itemDiscount.serialNumber || ""}
                              emptyLabel={useDispenseLot ? "Select lot(s)" : "Select Serial(s)"}
                              onChange={(sn) => {
                                updateItemDiscount(lineKey, "serialNumber", sn)
                                updateItemMetadata(lineKey, { serial_no: sn || undefined })
                                syncDispensingLotMetadata(lineKey, item.item_code || item.id, sn)
                              }}
                              isMobile={isMobile}
                            />
                          </div>
                        </div>
                        )}

                        {/* Row 4: Dosage | Prescription Frequency (Pharmacy only) */}
                        {isPharmacy && !isServiceItem && (
                          <div className="grid grid-cols-2 gap-3 mb-3 items-stretch">
                            <div className={cartFieldCellClass}>
                              <label className={cartFieldLabelClass}>
                                Dosage
                              </label>
                              <DosageInput
                                itemId={lineKey}
                                value={itemDiscount.dosage}
                                onChange={(_id, v) => updateItemDiscount(lineKey, "dosage", v)}
                                isMobile={isMobile}
                              />
                            </div>
                            <div className={cartFieldCellClass}>
                              <label className={cartFieldLabelClass}>
                                Prescription Frequency
                              </label>
                              <DosageSelectField
                                itemId={lineKey}
                                options={prescriptionFrequencies}
                                value={itemDiscount.prescriptionDosage || ""}
                                onChange={(dosageName) => updateItemDiscount(lineKey, "prescriptionDosage", dosageName)}
                                isMobile={isMobile}
                              />
                            </div>
                          </div>
                        )}

                        {/* Row 5: Reference (pink) | Item Tax Template (retail) | Add Service | Additional Amount */}
                        {(showPinkReference || showAddService || (isItemTaxTemplateMode && !isHospitalPharmacy) || (isAllowAdditionalAmounts && !isHospitalPharmacy)) && (
                          <div
                            className={`grid gap-3 mb-3 items-stretch ${
                              row5FieldCount >= 3
                                ? "grid-cols-3"
                                : row5FieldCount === 2
                                  ? "grid-cols-2"
                                  : "grid-cols-1"
                            }`}
                          >
                            {showPinkReference && (
                              <div className={cartFieldCellClass}>
                                <label className={cartFieldLabelClass}>
                                  Reference
                                </label>
                                <input
                                  type="text"
                                  value={(item as CartItem).reference_no || ""}
                                  onChange={(e) =>
                                    updateItemMetadata(lineKey, { reference_no: e.target.value })
                                  }
                                  placeholder="Enter reference..."
                                  className={cartFieldInputClass}
                                />
                              </div>
                            )}
                            {isItemTaxTemplateMode && !isHospitalPharmacy && (
                              <div className={cartFieldCellClass}>
                                <label className={cartFieldLabelClass}>
                                  Item Tax Template
                                </label>
                                <select
                                  value={(item as { item_tax_template?: string }).item_tax_template || ""}
                                  onChange={(e) =>
                                    updateItemMetadata(lineKey, { item_tax_template: e.target.value || null })
                                  }
                                  className={cartFieldInputClass}
                                >
                                  <option value="">— None (0%) —</option>
                                  {itemTaxTemplates.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {showAddService && (
                              <div className={cartFieldCellClass}>
                                <label className={cartFieldLabelClass}>
                                  Add Service
                                </label>
                                <button
                                  type="button"
                                  onClick={() => openPharmacyServiceModal(lineKey, item.name)}
                                  className={cartFieldActionButtonClass}
                                >
                                  Add Service
                                </button>
                              </div>
                            )}
                            {isAllowAdditionalAmounts && !isHospitalPharmacy && (
                              <div className={cartFieldCellClass}>
                                <label className={cartFieldLabelClass}>
                                  Additional Amount
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={((item as { additional_amount?: number }).additional_amount ?? "")}
                                  onChange={(e) =>
                                    updateItemMetadata(lineKey, {
                                      additional_amount: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  placeholder="0.00"
                                  className={cartFieldInputClass}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Discount Summary — hidden in hospital pharmacy */}
                      {!isHospitalPharmacy &&
                      (itemDiscount.discountPercentage > 0 ||
                        itemDiscount.discountAmount > 0) && (
                        <div className="mt-3 p-2 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800">
                          <div className="text-xs text-green-800 dark:text-green-300 font-medium">
                            Discount Applied:
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-xs text-green-700 dark:text-green-400">
                              {itemDiscount.discountPercentage > 0 &&
                                `${itemDiscount.discountPercentage}% off`}
                              {itemDiscount.discountPercentage > 0 &&
                                itemDiscount.discountAmount > 0 &&
                                " + "}
                              {itemDiscount.discountAmount > 0 &&
                                `${itemDiscount.discountAmount.toFixed(3)} off`}
                            </span>
                            <span className="text-xs font-semibold text-green-800 dark:text-green-300">
                              Save $
                              {(originalTotal - discountedTotal).toFixed(3)}
                            </span>
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Summary - Always Visible at Bottom on Mobile */}
      {cartItems.length > 0 && (
        <div
          className={`${
            isMobile
              ? "flex-shrink-0 p-3 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 shadow-lg"
              : "p-4 border-t border-gray-100 dark:border-gray-700"
          } space-y-3`}
        >

          {/* Action Buttons — hidden after dispense (New Order / Print flow) */}
          {!showPostDispenseActions && (
          <div
            className={`grid gap-3 ${isMobile ? "mb-3" : ""} ${
              isAllowAdditionalAmounts && !isHospitalPharmacy
                ? "grid-cols-[1fr_1fr_auto]"
                : isHospitalPharmacy
                  ? "grid-cols-2"
                  : "grid-cols-2"
            }`}
          >
            {!isHospitalPharmacy ? (
              <button
                onClick={() => {
                  if (!validateCustomer()) return;
                  const orderData = buildHoldOrderData();
                  if (!orderData) return;
                  handleHoldOrder(orderData);
                }}
                className="px-3 py-2 border border-beveren-600 text-beveren-600 dark:text-beveren-400 rounded-lg font-medium hover:bg-beveren-600 hover:text-white transition-colors text-sm"
              >
                Hold
              </button>
            ) : (
              <button
                onClick={() => void handleHoldDispenseOrder()}
                disabled={isDispensing}
                className="px-3 py-2 border border-beveren-600 text-beveren-600 dark:text-beveren-400 rounded-lg font-medium hover:bg-beveren-600 hover:text-white transition-colors text-sm disabled:opacity-50"
              >
                Hold
              </button>
            )}
            <button
              onClick={handleClearCart}
              className="px-3 py-2 border border-red-500 text-red-600 dark:text-red-400 rounded-lg font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm"
            >
              Clear Cart
            </button>
            {isAllowAdditionalAmounts && !isHospitalPharmacy && (
              <button
                onClick={() => setShowAdditionalAmountModal(true)}
                className="px-3 py-2 border border-beveren-500 text-beveren-600 dark:text-beveren-400 rounded-lg font-medium hover:bg-beveren-50 dark:hover:bg-beveren-900/20 transition-colors text-sm flex items-center justify-center min-w-[44px]"
                title="Add misc amount (e.g. syringe)"
              >
                <Plus size={18} />
              </button>
            )}
          </div>
          )}

          {/* Pay Button */}
          <button
            onClick={showPostDispenseActions ? handleStartNewOrder : handleDispense}
            disabled={isDispensing}
            className={`w-full bg-beveren-600 text-white rounded-xl font-semibold hover:bg-beveren-700 transition-colors ${
              isMobile ? "py-3 text-base" : "py-2 text-sm"
            } disabled:opacity-60`}
          >
            {isHospitalPharmacy
              ? (showPostDispenseActions
                ? "New Order"
                : isDispensing
                  ? "Dispensing..."
                  : `Dispense ${currency_symbol}${total.toFixed(3)}`)
              : `Checkout ${currency_symbol}${total.toFixed(3)}`}
          </button>
          {showPostDispenseActions && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => printMedicationLabels(lastDispensedLabelItems)}
                className="px-3 py-2 border border-beveren-600 text-beveren-600 rounded-lg font-medium hover:bg-beveren-50 transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Printer size={15} />
                Print Labels
              </button>
              <button
                type="button"
                onClick={() => printSalesOrder(lastDispensedSalesOrder)}
                className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors text-sm"
              >
                Print Dispense Order
              </button>
            </div>
          )}
          {!isHospitalPharmacy && showOpDispenseLabels && lastDispensedLabelItems.length > 0 && (
            <button
              type="button"
              onClick={() => printMedicationLabels(lastDispensedLabelItems)}
              className="w-full px-3 py-2 border border-beveren-600 text-beveren-600 rounded-lg font-medium hover:bg-beveren-50 transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Printer size={15} />
              Print Medication Labels
            </button>
          )}
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomerModal && (
        <AddCustomerModal
          customer={null}
          onClose={() => {
            setShowAddCustomerModal(false);
            setPrefilledCustomerName("");
            setPrefilledData({});
          }}
          onSave={handleSaveCustomer}
          prefilledName={prefilledCustomerName}
          prefilledData={prefilledData}
        />
      )}

      {/* Redeem Loyalty Points Modal */}
      {showRedeemLoyaltyModal && (() => {
        const maxPoints = Math.round(customerStats?.loyalty_points ?? selectedCustomer?.loyaltyPoints ?? 0);
        return (
          <div className="fixed inset-0 lg:left-20 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowRedeemLoyaltyModal(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-medium text-gray-900 dark:text-white mb-2">Redeem loyalty points</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">How many points to redeem? (max {maxPoints})</p>
              <input
                type="number"
                min={1}
                max={maxPoints}
                value={redeemPointsInput}
                onChange={(e) => setRedeemPointsInput(e.target.value.replace(/\D/g, "").slice(0, String(maxPoints).length))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-4"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.min(maxPoints, Math.max(0, parseInt(redeemPointsInput, 10) || 0));
                    setRedeemLoyaltyPoints(val > 0 ? val : null);
                    setShowRedeemLoyaltyModal(false);
                  }}
                  className="flex-1 px-3 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRedeemLoyaltyPoints(null);
                    setShowRedeemLoyaltyModal(false);
                  }}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Don&apos;t redeem
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Payment Dialog */}
      {showPaymentDialog && (
        <PaymentDialog
          isOpen={showPaymentDialog}
          onClose={handleClosePaymentDialog}
          redeemLoyaltyPoints={redeemLoyaltyPoints}
          // cartItems={cartItems.map((item) => {
          //   const itemAdditional = (item as { additional_amount?: number }).additional_amount || 0;
          //   return {
          //     ...item,
          //     discountedPrice: getDiscountedPrice(item),
          //     itemDiscount: itemDiscounts[item.id] || {},
          //     originalPrice: item.price,
          //     finalAmount: getDiscountedPrice(item) * item.quantity + itemAdditional,
          //   };
          // })}
          cartItems={cartItems.map((item) => {
  const lineKey = getLineKey(item);
  const itemAdditional = (item as { additional_amount?: number }).additional_amount || 0;

  // Merge persisted serial_no (cart store) with accumulated serialNumber (itemDiscounts)
  const cartItemSerial = (item as { serial_no?: string }).serial_no || "";
  const localSerial = itemDiscounts[lineKey]?.serialNumber || "";
  const mergedSerial = Array.from(new Set([
    ...cartItemSerial.split(",").map(s => s.trim()).filter(Boolean),
    ...localSerial.split(",").map(s => s.trim()).filter(Boolean),
  ])).join(",");

  const lineDiscount = itemDiscounts[lineKey] || {};
  const itemCode = item.item_code || item.id;
  const batchNo =
    lineDiscount.batchNumber?.trim() ||
    (item as CartItem & { batch_no?: string }).batch_no?.trim() ||
    "";
  const lotMap =
    serialLotMaps[getDispensingLotCacheKey(itemCode, batchNo)] ||
    serialLotMaps[itemCode] ||
    {};
  const mergedSerials = mergedSerial.split(",").map((s) => s.trim()).filter(Boolean);
  const resolvedLotNames = Array.from(
    new Set(
      mergedSerials.map((s) => lotMap[s]).filter(Boolean) as string[]
    )
  );
  const resolvedDispensingLots =
    (item as CartItem & { dispensing_lot?: string }).dispensing_lot ||
    (lineDiscount as { dispensingLot?: string }).dispensingLot ||
    joinDispensingLotNames(resolvedLotNames) ||
    undefined;

  return {
    ...item,
    discountedPrice: getDiscountedPrice(item),
    itemDiscount: {
      ...lineDiscount,
      serialNumber: mergedSerial,
      dispensingLot: resolvedDispensingLots,
    },
    originalPrice: item.price,
    finalAmount: getDiscountedPrice(item) * item.quantity + itemAdditional,
    dispensing_lot: resolvedDispensingLots,
    quantity: mergedSerials.length
      ? Math.max(item.quantity, mergedSerials.length)
      : item.quantity,
  };
})}
          appliedCoupons={appliedCoupons}
          selectedCustomer={selectedCustomer}
          onCompletePayment={handleCompletePayment}
          onHoldOrder={handleHoldOrder}
          isMobile={isMobile}
          itemDiscounts={itemDiscounts}
          totalItemDiscount={totalItemDiscount}
          generalAdditionalAmount={generalAdditionalAmount}
          additionalRemark={additionalRemark}
        />
      )}

      {/* Clinical appropriateness confirmation (hospital dispense) */}
      {showClinicalAppropriatenessConfirm && (
        <div
          className="fixed inset-0 lg:left-20 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowClinicalAppropriatenessConfirm(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-beveren-100 dark:bg-beveren-900/30 flex items-center justify-center flex-shrink-0">
                <Pill size={20} className="text-beveren-600 dark:text-beveren-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    Confirm dispense
                  </h3>
                  <button
                    type="button"
                    onClick={openDispenseDateModal}
                    disabled={isDispensing}
                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-beveren-600 dark:hover:text-beveren-400 disabled:opacity-50"
                    title="Change dispense date"
                    aria-label="Change dispense date"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                {dispenseRecordDate ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Recorded as {formatDispenseDateLabel(dispenseRecordDate)}
                  </p>
                ) : null}
              </div>
            </div>
            <p className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
              Medication checked for clinical appropriateness?
            </p>
            <div className="px-5 pb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Remark
              </label>
              <textarea
                rows={3}
                value={dispenseRemarks}
                onChange={(e) => setDispenseRemarks(e.target.value)}
                disabled={isDispensing}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm disabled:opacity-50"
                placeholder="Optional note for this dispense (saved on Sales Order)"
              />
            </div>
            <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClinicalAppropriatenessConfirm(false)}
                disabled={isDispensing}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClinicalAppropriateness}
                disabled={isDispensing}
                className="px-4 py-2 text-sm font-semibold text-white bg-beveren-600 hover:bg-beveren-700 rounded-lg disabled:opacity-50"
              >
                {isDispensing ? "Dispensing..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDispenseDateModal && (
        <div
          className="fixed inset-0 lg:left-20 z-[110] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowDispenseDateModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-xs border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                Dispense date
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Choose the date this dispense should be recorded on.
              </p>
            </div>
            <div className="px-4 py-3 space-y-3">
              <input
                type="date"
                value={dispenseDateDraft}
                max={todayISODate()}
                onChange={(e) => setDispenseDateDraft(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => void usePatientVisitDate()}
                disabled={isResolvingVisitDate}
                className="w-full px-3 py-2 text-sm font-medium rounded-lg border border-beveren-200 dark:border-beveren-800 text-beveren-700 dark:text-beveren-300 bg-beveren-50 dark:bg-beveren-900/20 hover:bg-beveren-100 dark:hover:bg-beveren-900/40 disabled:opacity-50"
              >
                {isResolvingVisitDate ? "Loading visit date..." : "Use patient visit date"}
              </button>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDispenseDateModal(false)}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyDispenseDateDraft}
                className="px-3 py-1.5 text-sm font-semibold text-white bg-beveren-600 hover:bg-beveren-700 rounded-lg"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pharmacy Service Modal */}
      {isHospitalPharmacy && (
        <PharmacyServiceModal
          isOpen={showPharmacyServiceModal}
          onClose={() => {
            setShowPharmacyServiceModal(false);
            setPharmacyServiceParent(null);
          }}
          parentItemName={pharmacyServiceParent?.itemName}
          currencySymbol={currency_symbol}
          onSelectService={handleSelectPharmacyService}
        />
      )}

      {/* Additional Amount Modal */}
      {isAllowAdditionalAmounts && !isHospitalPharmacy && (
        <AdditionalAmountModal
          isOpen={showAdditionalAmountModal}
          onClose={() => setShowAdditionalAmountModal(false)}
          cartItems={cartItems}
          onItemAdditionalChange={(id, amt) =>
            updateItemMetadata(id, { additional_amount: amt })
          }
          generalAmount={generalAdditionalAmount}
          onGeneralAmountChange={(amt) => setGeneralAdditionalAmount(amt)}
          remark={additionalRemark}
          onRemarkChange={(txt) => setAdditionalRemark(txt)}
          currencySymbol={currency_symbol}
        />
      )}

      {/* Patient Details Modal (hospital pharmacy) */}
      {isHospitalPharmacy && (
        <PatientDetailsModal
          isOpen={showPatientDetailsModal}
          onClose={() => setShowPatientDetailsModal(false)}
          patient={selectedPatient}
          patientHistory={patientHistorySummary}
          loading={loadingPatientHistory}
        />
      )}

      {/* Inpatient Medication Orders Modal */}
      <InpatientMedicationOrdersModal
        isOpen={showMedicationOrdersModal}
        onClose={() => {
          setShowMedicationOrdersModal(false);
          setSelectedOrders(new Set());
          setSelectedHistoryItems(new Set());
          setSelectedLegacyItems(new Set());
          setSelectedSubscriptionItems(new Set());
        }}
        pendingOrders={medicationOrders}
        historyOrders={medicationOrderHistory}
        legacyDispensedOrders={legacyDispensedMedications}
        subscriptionPlans={subscriptionMedicationPlans}
        selectedOrders={selectedOrders}
        onToggleOrder={(orderName) => {
          setSelectedOrders(prev => {
            const newSet = new Set(prev);
            if (newSet.has(orderName)) {
              newSet.delete(orderName);
            } else {
              newSet.add(orderName);
            }
            return newSet;
          });
        }}
        onAddToCart={handleAddOrdersToCart}
        selectedHistoryItems={selectedHistoryItems}
        onToggleHistoryItem={(itemKey) => {
          setSelectedHistoryItems((prev) => {
            const next = new Set(prev);
            if (next.has(itemKey)) next.delete(itemKey);
            else next.add(itemKey);
            return next;
          });
        }}
        onAddHistoryItemsToCart={handleAddHistoryItemsToCart}
        selectedLegacyItems={selectedLegacyItems}
        onToggleLegacyItem={(itemKey) => {
          setSelectedLegacyItems((prev) => {
            const next = new Set(prev);
            if (next.has(itemKey)) next.delete(itemKey);
            else next.add(itemKey);
            return next;
          });
        }}
        onAddLegacyItemsToCart={handleAddLegacyItemsToCart}
        selectedSubscriptionItems={selectedSubscriptionItems}
        onToggleSubscriptionItem={(itemKey) => {
          setSelectedSubscriptionItems((prev) => {
            const next = new Set(prev);
            if (next.has(itemKey)) next.delete(itemKey);
            else next.add(itemKey);
            return next;
          });
        }}
        onAddSubscriptionItemsToCart={handleAddSubscriptionItemsToCart}
        onCreateVisit={handleCreatePatientVisit}
        onSelectVisit={handleSelectPatientVisit}
        onReloadPendingOrders={async (includeUnsigned) => {
          const patientId =
            selectedPatient?.name || selectedCustomer?.id || selectedCustomer?.name;
          if (!patientId) return;
          const orders = await getPendingInpatientMedicationOrders(patientId, {
            includeUnsigned,
          });
          setMedicationOrders(orders);
          setSelectedOrders(new Set(orders.map((o) => o.name)));
        }}
        creatingVisit={isCreatingVisit}
        patientName={selectedPatient?.patient_name || selectedPatient?.name}
        patientId={
          selectedPatient?.name
          || selectedCustomer?.id
          || selectedCustomer?.name
        }
        isHospitalMode={isHospitalPharmacy}
        defaultUom={pharmacyDefaultUom || undefined}
        lastCreatedVisit={createdVisitRef}
        patientVisitCreatedSignal={patientVisitCreatedSignal}
        patientHistory={patientHistorySummary}
        productAvailability={productAvailability()}
      />
    </div>
  );
}
