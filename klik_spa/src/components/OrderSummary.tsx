"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Minus,
  Plus,
  X,
  Search,
  UserPlus,
  User,
  Building,
  Pill,
  Printer,
} from "lucide-react";
import type { CartItem, GiftCoupon } from "../../types";
import type { Customer } from "../types/customer";
import PaymentDialog from "./PaymentDialog";
import AddCustomerModal from "./AddCustomerModal";
import InpatientMedicationOrdersModal from "./InpatientMedicationOrdersModal";
import AdditionalAmountModal from "./AdditionalAmountModal";
import { createDraftSalesInvoice } from "../services/salesInvoice";
import { useCustomers } from "../hooks/useCustomers";
import { useProducts } from "../hooks/useProducts";
import { toast } from "react-toastify";
import { extractErrorFromException } from "../utils/errorExtraction";
import { getBatches } from "../utils/batch";
import { getSerials } from "../utils/serial";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { useItemTaxTemplates } from "../hooks/useItemTaxTemplates";
import { useItemTaxTemplateRates } from "../hooks/useItemTaxTemplateRates";
import { useFreeItemTaxAmount } from "../hooks/useFreeItemTaxAmount";
import { useCustomerStatistics } from "../hooks/useCustomerStatistics";
import { useCustomerPermission } from "../hooks/useCustomerPermission";
import { useCartStore } from "../stores/cartStore";
import { getPrescriptionFrequencies, type PrescriptionFrequency } from "../services/prescriptionFrequencyService";
import { searchPatients, getPendingInpatientMedicationOrders, getPatientMedicationOrderHistory, createPatientVisit, type Patient, type InpatientMedicationOrder } from "../services/patientService";
import { getItemPriceForCustomer } from "../services/dynamicPricing";
import { getItemUOMsAndPrices } from "../services/uomService";
import { createHospitalSalesOrder } from "../services/salesOrder";


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
      className={`w-full ${
        isMobile ? "text-sm" : "text-sm"
      } px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white`}
    />
  );
};

// Component to handle dosage input with local state (allows empty + decimals)
interface DosageInputProps {
  itemId: string;
  value: number | null | undefined;
  onChange: (itemId: string, value: number | null) => void;
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
    if (trimmed === "") {
      onChange(itemId, null);
      setInputValue("");
      return;
    }

    const numValue = Number(trimmed);
    if (Number.isNaN(numValue) || numValue < 0) {
      // Invalid input - reset to last known good value
      setInputValue(value === null || value === undefined ? "" : String(value));
      return;
    }

    // Normalize to remove leading zeros etc.
    onChange(itemId, numValue);
    setInputValue(String(numValue));
  };

  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onFocus={() => setIsEditing(true)}
      onBlur={handleBlur}
      placeholder="e.g. 9.8"
      className={`w-full ${
        isMobile ? "text-sm" : "text-sm"
      } px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white`}
    />
  );
};

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
        className={`w-full ${
          isMobile ? "text-sm" : "text-sm"
        } px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-left flex items-center justify-between`}
      >
        <span>{selectedUOM}</span>
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
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
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
  options: { batch_id: string; qty: number }[];
  value: string;
  onChange: (value: string, availableQty: number) => void;
  isMobile?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BatchSelectField = ({ itemId: _itemId, itemCode: _itemCode, options, value, onChange, isMobile }: BatchSelectFieldProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = options.filter(o => o.batch_id.toLowerCase().includes(query.toLowerCase()));

  const handleSelect = (batchId: string) => {
    const selectedQty = options.find(b => b.batch_id === batchId)?.qty || 0;
    onChange(batchId, selectedQty);
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full ${isMobile ? "text-xs" : "text-xs"} px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-left flex items-center justify-between`}
      >
        <span className="truncate">{value || "Select Batch"}</span>
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-44 overflow-hidden">
          <div className="p-1 border-b border-gray-200 dark:border-gray-600">
            <input
              type="text"
              placeholder="Filter batch..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              autoFocus
            />
          </div>
          <div className="max-h-36 overflow-y-auto">
            {filtered.length > 0 ? filtered.map((b) => (
              <button
                key={b.batch_id}
                type="button"
                onClick={() => handleSelect(b.batch_id)}
                className={`w-full px-2 py-1 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${value === b.batch_id ? 'bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400' : 'text-gray-900 dark:text-white'}`}
              >
                {b.batch_id} - {b.qty}
              </button>
            )) : (
              <div className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">No matches</div>
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

// Compact multi-select searchable dropdown for Serial selection
interface SerialSelectFieldProps {
  itemId: string;
  itemCode: string;
  options: string[];
  value: string; // comma-separated: "SN001,SN002,SN003"
  onChange: (value: string) => void;
  isMobile?: boolean;
}

const SerialSelectField = ({ itemId: _itemId, itemCode: _itemCode, options, value, onChange, isMobile }: SerialSelectFieldProps) => {
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

  const filtered = options.filter(sn =>
    sn.toLowerCase().includes(query.toLowerCase())
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
        className={`w-full ${isMobile ? "text-xs" : "text-xs"} px-2 py-1 min-h-[30px] border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-left flex flex-wrap items-center gap-1`}
      >
        {count === 0 ? (
          <span className="text-gray-400 dark:text-gray-500">Select Serial(s)</span>
        ) : (
          <>
            {selectedArray.slice(0, 3).map(sn => (
              <span
                key={sn}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-beveren-100 dark:bg-beveren-900/30 text-beveren-700 dark:text-beveren-300 rounded text-xs font-medium"
              >
                {sn.length > 8 ? `${sn.slice(0, 6)}...` : sn}
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
          className={`w-3 h-3 ml-auto flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-52 overflow-hidden">
          {/* Search */}
          <div className="p-1 border-b border-gray-200 dark:border-gray-600">
            <input
              type="text"
              placeholder="Filter serial..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
              filtered.map((sn) => {
                const isSelected = selected.has(sn);
                return (
                  <button
                    key={sn}
                    type="button"
                    onClick={() => toggleSerial(sn)}
                    className={`w-full px-2 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      isSelected
                        ? 'bg-beveren-50 dark:bg-beveren-900/20 text-beveren-700 dark:text-beveren-300'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {/* Checkbox */}
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
                    {sn}
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
  const filtered = options.filter(freq =>
    (freq.name || "").toLowerCase().includes(query.toLowerCase()) ||
    (freq.frequency || freq.dosage || freq.prescription_frequency || "").toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (freqName: string) => {
    onChange(freqName);
    setIsOpen(false);
    setQuery("");
  };

  const getDisplayName = (freq: PrescriptionFrequency) => {
    return freq.frequency || freq.prescription_frequency || freq.dosage || freq.name || "";
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full ${isMobile ? "text-xs" : "text-xs"} px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-left flex items-center justify-between`}
      >
        <span className="truncate">{value || "Select frequency"}</span>
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-44 overflow-hidden">
          <div className="p-1 border-b border-gray-200 dark:border-gray-600">
            <input
              type="text"
              placeholder="Filter frequency..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              autoFocus
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
                  className={`w-full px-2 py-1 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${value === freq.name ? 'bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400' : 'text-gray-900 dark:text-white'}`}
                >
                  {displayName}
                </button>
              );
            }) : (
              <div className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

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
    redeemLoyaltyPoints,
    setRedeemLoyaltyPoints,
    updateUOM,
    updatePricesForCustomer,
    addToCartWithQuantity,
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
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showMedicationOrdersModal, setShowMedicationOrdersModal] = useState(false);
  const [showRedeemLoyaltyModal, setShowRedeemLoyaltyModal] = useState(false);
  const [showAdditionalAmountModal, setShowAdditionalAmountModal] = useState(false);
  const [redeemPointsInput, setRedeemPointsInput] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [medicationOrders, setMedicationOrders] = useState<InpatientMedicationOrder[]>([]);
  const [medicationOrderHistory, setMedicationOrderHistory] = useState<InpatientMedicationOrder[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [selectedHistoryItems, setSelectedHistoryItems] = useState<Set<string>>(new Set());
  const [isCreatingVisit, setIsCreatingVisit] = useState(false);
  const [createdVisitRef, setCreatedVisitRef] = useState<{ doctype: string; name: string } | null>(null);
  const [isDispensing, setIsDispensing] = useState(false);
  const [lastDispensedSalesOrder, setLastDispensedSalesOrder] = useState<string | null>(null);
  // const couponButtonRef = useRef<HTMLButtonElement>(null);
  const { customers, isLoading, refetch: refetchCustomers } = useCustomers(customerSearchQuery);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { products, refetch: _refetchProducts, refreshStockOnly, updateStockForItems: _updateStockForItems, updateBatchQuantitiesForItems, updateSerialsForItems } = useProducts();
  // const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { posDetails, loading: _posLoading } = usePOSDetails();
  const { checkCustomerPermission } = useCustomerPermission();
  
  // Check if pharmacy mode is enabled
  const isPharmacy = posDetails?.custom_is_pharmacy === 1 ||
                     posDetails?.custom_is_pharmacy === true ||
                     posDetails?.custom_is_pharmacy === "1";
  const isHospitalPharmacy = posDetails?.custom_is_hospital_pharmacy === 1 ||
                             posDetails?.custom_is_hospital_pharmacy === true ||
                             posDetails?.custom_is_hospital_pharmacy === "1";

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

  // Search for patients when pharmacy mode is enabled and search query changes
  useEffect(() => {
    if (isPharmacy && customerSearchQuery.trim().length >= 2) {
      const searchPatientsDebounced = setTimeout(() => {
        searchPatients(customerSearchQuery.trim())
          .then(setPatients)
          .catch((error) => {
            console.error('Error searching patients:', error);
            setPatients([]);
          });
      }, 300);
      
      return () => clearTimeout(searchPatientsDebounced);
    } else {
      setPatients([]);
    }
  }, [customerSearchQuery, isPharmacy]);
  
  // State for prescription frequencies (from Prescription Frequency doctype)
  const [prescriptionFrequencies, setPrescriptionFrequencies] = useState<PrescriptionFrequency[]>([]);
  const [frequenciesLoaded, setFrequenciesLoaded] = useState(false);
  
  // Load prescription frequencies when pharmacy is enabled OR when items are added to cart
  useEffect(() => {
    if (isPharmacy && !frequenciesLoaded) {
      getPrescriptionFrequencies()
        .then((frequencies) => {
          setPrescriptionFrequencies(frequencies);
          setFrequenciesLoaded(true);
        })
        .catch((error) => {
          console.error('❌ Error loading prescription frequencies:', error);
        });
    }
  }, [isPharmacy, frequenciesLoaded]);
  
  // Also load frequencies when items are added to cart (if pharmacy mode is enabled)
  useEffect(() => {
    if (isPharmacy && cartItems.length > 0 && !frequenciesLoaded) {
      getPrescriptionFrequencies()
        .then((frequencies) => {
          setPrescriptionFrequencies(frequencies);
          setFrequenciesLoaded(true);
        })
        .catch((error) => {
          console.error('❌ Error loading prescription frequencies:', error);
        });
    }
  }, [cartItems.length, isPharmacy, frequenciesLoaded]);

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
        availableQuantity: number;
        prescriptionDosage?: string; // From Prescription Frequency doctype (dropdown)
        dosage?: number | null; // Actual dosage amount/quantity (float input)
        medicationOrder?: string; // Patient Medication Order (when items added from order)
      }
    >
  >({});

  const [itemBatches, setItemBatches] = useState<
    Record<string, { batch_id: string; qty: number }[]>
  >({});

  const [itemSerials, setItemSerials] = useState<
    Record<string, string[]>
  >({});

  // Pending pre-selections when item not yet in cart
  const [pendingPreselect, setPendingPreselect] = useState<
    Record<string, { batchId?: string; serialNo?: string }>
  >({});

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Ref so batch/serial handlers always merge with latest discounts (avoids losing other lines when state is stale)
  const itemDiscountsRef = useRef(itemDiscounts);
  useEffect(() => {
    itemDiscountsRef.current = itemDiscounts;
  }, [itemDiscounts]);

  // Per-line key for batch/serial/discount (same item can appear in multiple lines when allow duplicate)
  const getLineKey = (i: CartItem) => (i as CartItem & { cartLineId?: string }).cartLineId || i.id;

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
    if (e.key === "Enter" && customerSearchQuery.trim() !== "") {
      // Check if there are no matching customers
      if (filteredCustomers.length === 0) {
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
      } else if (filteredCustomers.length === 1 && !userRemovedDefaultCustomer && filteredCustomers[0]) {
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

  const validateCustomer = () => {
    if (!selectedCustomer) {
      toast.error("Kindly choose customer");
      return false;
    }
    return true;
  };

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerSearchQuery(customer.name);
    setShowCustomerDropdown(false);
    setUserRemovedDefaultCustomer(false); // Reset flag when user explicitly selects a customer
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
    
    // Patient full name (patient_name) is the same as customer name, try to find matching customer
    const matchingCustomer = customers.find(
      c => c.name.toLowerCase() === patientName.toLowerCase() || 
           c.customer_name?.toLowerCase() === patientName.toLowerCase()
    );
    
    if (matchingCustomer) {
      // Set the customer as well since patient_name matches customer name
      setSelectedCustomer(matchingCustomer);
    }
    
    // Fetch pending/history medication orders for this patient and automatically add pending to cart
    try {
      const [orders, history] = await Promise.all([
        getPendingInpatientMedicationOrders(patient.name),
        getPatientMedicationOrderHistory(patient.name, 50),
      ]);
      setMedicationOrders(orders);
      setMedicationOrderHistory(history);
      
      if (orders.length === 0) {
        toast.info("No pending medication orders found for this patient.");
        return;
      }
      
      // Automatically add all medication orders to cart (quantity, uom, patient_frequency from order entry)
      const selectedOrderNamesAll = Array.from(new Set(orders.map((o) => o.name).filter(Boolean)));
      const itemsToAdd: Array<{ item_code: string; quantity: number; uom?: string; dosage?: string; patient_frequency?: string; drug_name?: string; medication_order?: string }> = [];
      
      orders.forEach(order => {
        order.items.forEach(item => {
          if (item.drug) {
            itemsToAdd.push({
              item_code: item.drug,
              quantity: item.quantity ?? 1,
              uom: item.uom,
              dosage: item.dosage || undefined,
              patient_frequency: item.patient_frequency,
              drug_name: item.drug_name || undefined,
              medication_order: order.name,
            });
          }
        });
      });
      
      if (itemsToAdd.length === 0) {
        toast.warning("No items found in medication orders.");
        return;
      }
      
      // Show loading toast
      const loadingToast = toast.loading(`Adding ${itemsToAdd.length} item(s) from ${orders.length} order(s) to cart...`);
      
      try {
        let addedCount = 0;
        let notFoundCount = 0;

        // IMPORTANT: cartItems updates are async; keep a local running quantity map so multiple
        // medication orders for the same item_code accumulate correctly within this loop.
        const qtyByItem = new Map<string, number>();
        const medsByItem = new Map<string, Set<string>>();
        cartItems.forEach((ci) => {
          qtyByItem.set(ci.id, ci.quantity);
          const existing = (ci as unknown as { medicationOrders?: string[] }).medicationOrders;
          if (Array.isArray(existing) && existing.length) {
            medsByItem.set(ci.id, new Set(existing));
          }
        });
        
        // Process each item
        for (const itemToAdd of itemsToAdd) {
          // Find the product in the products list
          const product = products.find(p => p.id === itemToAdd.item_code || p.item_code === itemToAdd.item_code);
          
          if (!product) {
            console.warn(`Product not found for item_code: ${itemToAdd.item_code}`);
            notFoundCount++;
            continue;
          }

          const uomToUse = itemToAdd.uom || ((isPharmacy && pharmacyDefaultUom) ? pharmacyDefaultUom : product.uom);
          const cartQuantity = await convertOrderQuantityToCartUOM(
            product.id,
            itemToAdd.quantity,
            itemToAdd.uom,
            uomToUse
          );
          
          const prescriptionDosageValue = itemToAdd.patient_frequency || itemToAdd.dosage;
          
          const currentQty = qtyByItem.get(product.id) ?? 0;
          const willExist = currentQty > 0;

          if (willExist) {
            const newQuantity = currentQty + cartQuantity;
            await onUpdateQuantity(product.id, newQuantity);
            qtyByItem.set(product.id, newQuantity);
            
            if (prescriptionDosageValue) {
              updateItemDiscount(product.id, "prescriptionDosage", prescriptionDosageValue);
            }
            if (itemToAdd.dosage != null && itemToAdd.dosage !== "") {
              const dosageVal = parseFloat(String(itemToAdd.dosage));
              updateItemDiscount(product.id, "dosage", Number.isNaN(dosageVal) ? itemToAdd.dosage : dosageVal);
            }
            if (itemToAdd.medication_order) {
              const s = medsByItem.get(product.id) ?? new Set<string>();
              s.add(itemToAdd.medication_order);
              selectedOrderNamesAll.forEach((o) => s.add(o));
              medsByItem.set(product.id, s);
              const arr = Array.from(s);
              // Keep medicationOrder for backward compatibility, but also keep all selected orders.
              updateItemMetadata(product.id, { medicationOrder: itemToAdd.medication_order, medicationOrders: arr });
              updateItemDiscount(product.id, "medicationOrder", itemToAdd.medication_order);
            }
            
            addedCount++;
          } else {
            let priceToUse = product.price;

            if (isPharmacy && uomToUse && uomToUse !== product.uom && !selectedCustomer) {
              const priceInfo = await getItemPriceForCustomer(product.id, undefined, uomToUse);
              if (priceInfo?.success && priceInfo.price > 0) {
                priceToUse = priceInfo.price;
              }
            }

            await addToCartWithQuantity(
              {
                id: product.id,
                name: product.name,
                category: product.category || 'General',
                price: priceToUse,
                image: product.image || '',
                available: product.available,
                uom: uomToUse,
                item_code: product.id,
                ...(itemToAdd.medication_order && { medicationOrder: itemToAdd.medication_order, medicationOrders: [itemToAdd.medication_order] }),
              },
              cartQuantity
            );
            qtyByItem.set(product.id, cartQuantity);
            
            if (prescriptionDosageValue) {
              setTimeout(() => {
                updateItemDiscount(product.id, "prescriptionDosage", prescriptionDosageValue);
              }, 100);
            }
            if (itemToAdd.dosage != null && itemToAdd.dosage !== "") {
              const dosageVal = parseFloat(String(itemToAdd.dosage));
              setTimeout(() => {
                updateItemDiscount(product.id, "dosage", Number.isNaN(dosageVal) ? itemToAdd.dosage : dosageVal);
              }, 100);
            }
            if (itemToAdd.medication_order) {
              const s = medsByItem.get(product.id) ?? new Set<string>();
              s.add(itemToAdd.medication_order);
              selectedOrderNamesAll.forEach((o) => s.add(o));
              medsByItem.set(product.id, s);
              updateItemMetadata(product.id, { medicationOrder: itemToAdd.medication_order, medicationOrders: Array.from(s) });
              setTimeout(() => {
                updateItemDiscount(product.id, "medicationOrder", itemToAdd.medication_order!);
              }, 100);
            }
            
            addedCount++;
          }
        }
        
        toast.dismiss(loadingToast);
        
        if (addedCount > 0 && notFoundCount === 0) {
          toast.success(`Successfully added ${addedCount} item(s) from ${orders.length} order(s) to cart.`);
        } else if (addedCount > 0 && notFoundCount > 0) {
          toast.warning(`Added ${addedCount} item(s) to cart. ${notFoundCount} item(s) not found.`);
        } else {
          toast.error(`Failed to add items. None of the items were found in the product list.`);
        }
        
      } catch (error) {
        console.error('Error adding items to cart:', error);
        toast.dismiss(loadingToast);
        toast.error('Failed to add items to cart. Please try again.');
      }
      
    } catch (error) {
      console.error('❌ Error fetching medication orders:', error);
      toast.error("Failed to fetch medication orders.");
    }
  };
  
  const handleAddOrdersToCart = async () => {
    if (selectedOrders.size === 0) {
      toast.warning("Please select at least one medication order.");
      return;
    }
    
    // Get selected orders
    const ordersToAdd = medicationOrders.filter(order => selectedOrders.has(order.name));
    const selectedOrderNames = Array.from(new Set(ordersToAdd.map((o) => o.name).filter(Boolean)));
    
    // Collect all items from selected orders (quantity, uom, patient_frequency from order entry)
    const itemsToAdd: Array<{ item_code: string; quantity: number; uom?: string; dosage?: string; patient_frequency?: string; drug_name?: string; medication_order?: string }> = [];
    
    ordersToAdd.forEach(order => {
      order.items.forEach(item => {
        if (item.drug) {
          itemsToAdd.push({
            item_code: item.drug,
            quantity: item.quantity ?? 1,
            uom: item.uom,
            dosage: item.dosage || undefined,
            patient_frequency: item.patient_frequency,
            drug_name: item.drug_name || undefined,
            medication_order: order.name,
          });
        }
      });
    });
    
    if (itemsToAdd.length === 0) {
      toast.warning("No items found in selected orders.");
      setShowMedicationOrdersModal(false);
      setSelectedOrders(new Set());
      return;
    }
    
    const loadingToast = toast.loading(`Adding ${itemsToAdd.length} item(s) to cart...`);
    
    try {
      let addedCount = 0;
      let notFoundCount = 0;

      // Keep a running local view of quantities + medication orders during this async loop.
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
        const product = products.find(p => p.id === itemToAdd.item_code || p.item_code === itemToAdd.item_code);
        
        if (!product) {
          console.warn(`Product not found for item_code: ${itemToAdd.item_code}`);
          notFoundCount++;
          continue;
        }

        const uomToUse = itemToAdd.uom || ((isPharmacy && pharmacyDefaultUom) ? pharmacyDefaultUom : product.uom);
        const cartQuantity = await convertOrderQuantityToCartUOM(
          product.id,
          itemToAdd.quantity,
          itemToAdd.uom,
          uomToUse
        );
        const prescriptionDosageValue = itemToAdd.patient_frequency || itemToAdd.dosage;

        const currentQty = qtyByItem.get(product.id) ?? 0;
        const willExist = currentQty > 0;

        if (willExist) {
          const newQuantity = currentQty + cartQuantity;
          await onUpdateQuantity(product.id, newQuantity);
          qtyByItem.set(product.id, newQuantity);
          
          if (prescriptionDosageValue) {
            updateItemDiscount(product.id, "prescriptionDosage", prescriptionDosageValue);
          }
          if (itemToAdd.dosage != null && itemToAdd.dosage !== "") {
            const dosageVal = parseFloat(String(itemToAdd.dosage));
            updateItemDiscount(product.id, "dosage", Number.isNaN(dosageVal) ? itemToAdd.dosage : dosageVal);
          }
          if (itemToAdd.medication_order) {
            const s = medsByItem.get(product.id) ?? new Set<string>();
            s.add(itemToAdd.medication_order);
            selectedOrderNames.forEach((o) => s.add(o));
            medsByItem.set(product.id, s);
            const arr = Array.from(s);
            updateItemMetadata(product.id, { medicationOrder: itemToAdd.medication_order, medicationOrders: arr });
            updateItemDiscount(product.id, "medicationOrder", itemToAdd.medication_order);
          }
          
          addedCount++;
        } else {
          let priceToUse = product.price;

          if (isPharmacy && uomToUse && uomToUse !== product.uom && !selectedCustomer) {
            const priceInfo = await getItemPriceForCustomer(product.id, undefined, uomToUse);
            if (priceInfo?.success && priceInfo.price > 0) {
              priceToUse = priceInfo.price;
            }
          }

          await addToCartWithQuantity(
            {
              id: product.id,
              name: product.name,
              category: product.category || 'General',
              price: priceToUse,
              image: product.image || '',
              available: product.available,
              uom: uomToUse,
              item_code: product.id,
              ...(itemToAdd.medication_order && { medicationOrder: itemToAdd.medication_order, medicationOrders: [itemToAdd.medication_order] }),
            },
            cartQuantity
          );
          qtyByItem.set(product.id, cartQuantity);
          
          if (prescriptionDosageValue) {
            setTimeout(() => {
              updateItemDiscount(product.id, "prescriptionDosage", prescriptionDosageValue);
            }, 100);
          }
          if (itemToAdd.dosage != null && itemToAdd.dosage !== "") {
            const dosageVal = parseFloat(String(itemToAdd.dosage));
            setTimeout(() => {
              updateItemDiscount(product.id, "dosage", Number.isNaN(dosageVal) ? itemToAdd.dosage : dosageVal);
            }, 100);
          }
          if (itemToAdd.medication_order) {
            const s = medsByItem.get(product.id) ?? new Set<string>();
            s.add(itemToAdd.medication_order);
            selectedOrderNames.forEach((o) => s.add(o));
            medsByItem.set(product.id, s);
            updateItemMetadata(product.id, { medicationOrder: itemToAdd.medication_order, medicationOrders: Array.from(s) });
            setTimeout(() => {
              updateItemDiscount(product.id, "medicationOrder", itemToAdd.medication_order!);
            }, 100);
          }
          
          addedCount++;
        }
      }
      
      toast.dismiss(loadingToast);
      
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

  const openMedicationOrdersModal = async () => {
    const patientToUse = selectedPatient || (selectedCustomer ? patients.find(
      p => (p.patient_name || p.name).toLowerCase() === selectedCustomer.name.toLowerCase()
    ) : null);
    const patientId = patientToUse?.name ?? selectedCustomer?.id ?? selectedCustomer?.name;
    if (!patientId) {
      toast.error("Patient not found.");
      return;
    }
    try {
      const [orders, history] = await Promise.all([
        getPendingInpatientMedicationOrders(patientId),
        getPatientMedicationOrderHistory(patientId, 50),
      ]);
      setMedicationOrders(orders);
      setMedicationOrderHistory(history);
      setSelectedOrders(new Set(orders.map(o => o.name)));
      setShowMedicationOrdersModal(true);
      if (orders.length === 0 && history.length === 0) {
        toast.info("No medication orders found for this patient.");
      }
    } catch (error) {
      console.error('Error fetching medication orders:', error);
      toast.error("Failed to fetch medication orders.");
    }
  };

  const handleAddHistoryItemsToCart = async () => {
    if (selectedHistoryItems.size === 0) {
      toast.warning("Please select at least one history item.");
      return;
    }
    const itemsToAdd: Array<{ item_code: string; quantity: number; uom?: string; dosage?: string; patient_frequency?: string; medication_order?: string }> = [];
    medicationOrderHistory.forEach((order) => {
      order.items.forEach((item, idx) => {
        const key = `${order.name}::${idx}::${item.drug ?? ""}`;
        if (selectedHistoryItems.has(key) && item.drug) {
          itemsToAdd.push({
            item_code: item.drug,
            quantity: item.quantity ?? 1,
            uom: item.uom,
            dosage: item.dosage || undefined,
            patient_frequency: item.patient_frequency,
            medication_order: order.name,
          });
        }
      });
    });
    if (itemsToAdd.length === 0) {
      toast.warning("No valid items selected.");
      return;
    }
    const loadingToast = toast.loading(`Adding ${itemsToAdd.length} history item(s) to cart...`);
    try {
      let addedCount = 0;
      let notFoundCount = 0;
      const qtyByItem = new Map<string, number>();
      cartItems.forEach((ci) => qtyByItem.set(ci.id, ci.quantity));

      for (const itemToAdd of itemsToAdd) {
        const product = products.find(p => p.id === itemToAdd.item_code || p.item_code === itemToAdd.item_code);
        if (!product) {
          notFoundCount++;
          continue;
        }
        const uomToUse = itemToAdd.uom || ((isPharmacy && pharmacyDefaultUom) ? pharmacyDefaultUom : product.uom);
        const cartQuantity = await convertOrderQuantityToCartUOM(product.id, itemToAdd.quantity, itemToAdd.uom, uomToUse);
        const currentQty = qtyByItem.get(product.id) ?? 0;
        if (currentQty > 0) {
          const newQty = currentQty + cartQuantity;
          await onUpdateQuantity(product.id, newQty);
          qtyByItem.set(product.id, newQty);
        } else {
          await addToCartWithQuantity(
            {
              id: product.id,
              name: product.name,
              category: product.category || "General",
              price: product.price,
              image: product.image || "",
              available: product.available,
              uom: uomToUse,
              item_code: product.id,
              ...(itemToAdd.medication_order && { medicationOrder: itemToAdd.medication_order, medicationOrders: [itemToAdd.medication_order] }),
            },
            cartQuantity
          );
          qtyByItem.set(product.id, cartQuantity);
        }
        addedCount++;
      }
      toast.dismiss(loadingToast);
      if (addedCount > 0 && notFoundCount === 0) toast.success(`Successfully added ${addedCount} history item(s).`);
      else if (addedCount > 0) toast.warning(`Added ${addedCount} item(s). ${notFoundCount} item(s) not found.`);
      else toast.error("No history items were added.");
      setSelectedHistoryItems(new Set());
    } catch {
      toast.dismiss(loadingToast);
      toast.error("Failed to add history items to cart.");
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
        setCreatedVisitRef({ doctype: result.doctype, name: result.name });
        toast.success(`Created ${result.doctype}: ${result.name}`);
      } else {
        toast.error("Failed to create patient visit.");
      }
    } catch (error) {
      toast.error(extractErrorFromException(error, "Failed to create patient visit"));
    } finally {
      setIsCreatingVisit(false);
    }
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

  const handleClosePaymentDialog = async (paymentCompleted?: boolean) => {
    setShowPaymentDialog(false);

    // Only clear cart if payment was completed
    if (paymentCompleted) {
      // console.log("OrderSummary: Payment was completed - clearing cart for next order");
      handleClearCart();
    } else {
      console.log("OrderSummary: Payment was not completed - keeping cart items");
    }

    // Refresh stock so cashier can see updated availability
    try {
      const success = await refreshStockOnly();
      if (success) {
        // toast.success("Stock updated - ready for next order!");
      } else {
        console.log("OrderSummary: No stock updates needed");
      }

      // Also update batch quantities for items that were in the cart
      const cartItemCodes = cartItems.map(item => item.item_code || item.id);
      if (cartItemCodes.length > 0) {
        try {
          await updateBatchQuantitiesForItems(cartItemCodes);
        } catch (error) {
          console.error("OrderSummary: Failed to update batch quantities:", error);
        }
        try {
          await updateSerialsForItems(cartItemCodes);
        } catch (error) {
          console.error("OrderSummary: Failed to update serials:", error);
        }
      }
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("OrderSummary: Failed to refresh stock:", error);
      const errorMessage = error?.message || "Unknown error";
      toast.error(`Failed to update stock: ${errorMessage}`);
    }
  };

  const handleStartNewOrder = async () => {
    handleClearCart();
    setLastDispensedSalesOrder(null);
    setCreatedVisitRef(null);
    try {
      await refreshStockOnly();
      const cartItemCodes = cartItems.map(item => item.item_code || item.id);
      if (cartItemCodes.length > 0) {
        await updateBatchQuantitiesForItems(cartItemCodes);
        await updateSerialsForItems(cartItemCodes);
      }
    } catch (error) {
      console.error("Failed to refresh stock for new order:", error);
    }
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

  const handleDispense = async () => {
    if (!validateCustomer()) return;
    if (!selectedCustomer) return;
    if (!isHospitalPharmacy) {
      setShowPaymentDialog(true);
      return;
    }
    try {
      setIsDispensing(true);
      const allMedicationOrders = Array.from(new Set(
        cartItems.flatMap((item) => {
          const many = (item as CartItem & { medicationOrders?: string[] }).medicationOrders || [];
          const one = (item as CartItem & { medicationOrder?: string }).medicationOrder;
          return [...many, ...(one ? [one] : [])].filter(Boolean);
        })
      ));
      const firstMedicationOrder = allMedicationOrders[0];
      const sourceOrder = [...medicationOrders, ...medicationOrderHistory].find((o) => o.name === firstMedicationOrder);
      const finalReferenceType = createdVisitRef?.doctype || sourceOrder?.custom_reference_type || "Patient Visit";
      const finalReferenceName = createdVisitRef?.name || sourceOrder?.custom_reference_name || "";

      const payload = {
        customer: { id: selectedCustomer.id },
        items: cartItems.map((item) => {
          const lineKey = getLineKey(item);
          const lineDiscount = (itemDiscounts[lineKey] || {}) as { batchNumber?: string; serialNumber?: string };
          return {
            id: item.id,
            item_code: item.item_code || item.id,
            quantity: item.quantity,
            price: getDiscountedPrice(item),
            uom: item.uom,
            batchNumber: lineDiscount.batchNumber || (item as CartItem & { batch_no?: string }).batch_no,
            serialNumber: lineDiscount.serialNumber || (item as CartItem & { serial_no?: string }).serial_no,
          };
        }),
        medication_orders: allMedicationOrders,
        base_reference: "Patient Medication Order",
        base_reference_name: allMedicationOrders.join(", "),
        reference_type: finalReferenceType,
        reference_name: finalReferenceName,
      };

      const result = await createHospitalSalesOrder(payload);
      const soName = result?.sales_order_name;
      if (!soName) {
        toast.error("Dispense failed. Sales Order was not created.");
        return;
      }
      setLastDispensedSalesOrder(soName);
      toast.success(`Dispensed successfully. Sales Order: ${soName}`);
    } catch (error) {
      toast.error(extractErrorFromException(error, "Failed to dispense items"));
    } finally {
      setIsDispensing(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleHoldOrder = async (orderData: any) => {
    if (!selectedCustomer) {
      toast.error("Kindly select a customer");
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
    if (customers.length === 1 && !selectedCustomer && !isLoading) {
      const singleCustomer = customers[0];
      if (singleCustomer) {
        setSelectedCustomer(singleCustomer);
        setCustomerSearchQuery(singleCustomer.name);
      }
      setShowCustomerDropdown(false);

      // toast.info(`Automatically selected customer: ${singleCustomer.name}`);
    }
  }, [customers, selectedCustomer, isLoading]);

  // Set default customer from POS profile when available
  useEffect(() => {

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
  }, [posDetails, selectedCustomer, _posLoading, userRemovedDefaultCustomer, checkCustomerPermission]);

  useEffect(() => {
    const fetchAndSetInfo = async () => {
      const newBatches = { ...itemBatches };
      const newSerials = { ...itemSerials } as Record<string, string[]>;

      for (const item of cartItems) {
        const key = item.item_code || item.id;
        if (key && key !== 'undefined') {
          if (!newBatches[key]) {
            try {
              const batches = await getBatches(item.id);
              if (Array.isArray(batches)) newBatches[key] = batches;
            } catch (err) {
              console.error("Error fetching batches", err);
            }
          }
          if (!newSerials[key]) {
            try {
              const serials = await getSerials(key);
              if (Array.isArray(serials)) newSerials[key] = serials;
            } catch (err) {
              console.error("Error fetching serials", err);
            }
          }
        } else {
          console.log(`OrderSummary: Skipping initial info loading for key "${key}"`);
        }
      }

      setItemBatches(newBatches);
      setItemSerials(newSerials);
    };

    if (cartItems.length) {
      fetchAndSetInfo();
    }
  }, [cartItems]);

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
        ...(base[lineKey] || { discountPercentage: 0, discountAmount: 0, batchNumber: '', serialNumber: '', availableQuantity: 0 }),
        batchNumber: batchId || '',
        availableQuantity: selectedQty,
      }
    });
    // ✅ Only update batch metadata here — no serial logic
    updateItemMetadata(lineKey, { batch_no: batchId || undefined });
  } else {
    setPendingPreselect(prev => ({
      ...prev,
      [itemCode]: { ...(prev[itemCode] || {}), batchId, forLastAdded }
    }));
  }
}

const handleSetSerial = (event: CustomEvent) => {
  const { itemCode, serialNo, forLastAdded, lineKey: detailLineKey } = event.detail as { itemCode: string; serialNo: string; forLastAdded?: boolean; lineKey?: string };
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
    setItemDiscounts({
      ...base,
      [lineKey]: {
        ...(base[lineKey] || { discountPercentage: 0, discountAmount: 0, batchNumber: '', serialNumber: '', availableQuantity: 0 }),
        serialNumber: accumulated,
      }
    });
    // ✅ Persist full accumulated serial string
    updateItemMetadata(lineKey, { serial_no: accumulated || undefined });
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
      window.removeEventListener('serialsUpdated', handleSerialUpdate as EventListener);
      window.removeEventListener('cart:setBatchForItem', handleSetBatch as EventListener)
      window.removeEventListener('cart:setSerialForItem', handleSetSerial as EventListener)
    };
  }, [cartItems, itemBatches, getLineKey, updateItemMetadata]);

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
          setItemDiscounts({
            ...base,
            [lineKey]: {
              ...(base[lineKey] || { discountPercentage: 0, discountAmount: 0, batchNumber: '', serialNumber: '', availableQuantity: 0 }),
              // serialNumber: pending.serialNo || '',
              serialNumber: (() => {
                  const existing = new Set(
                    (base[lineKey]?.serialNumber || '').split(',').map(s => s.trim()).filter(Boolean)
                  );
                  if (pending.serialNo) existing.add(pending.serialNo);
                  return Array.from(existing).join(',');
                })(),
            }
          })
          updateItemMetadata(lineKey, { serial_no: pending.serialNo || undefined })
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
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder={isPharmacy ? "Search customers or patients... (name, email, phone, patient ID, or file no)" : "Search customers... (name, email, or phone)"}
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
                  onBlur={(e) => {
                    // Don't close dropdown immediately on blur - allow time for click
                    // Check if the blur is due to clicking on dropdown
                    setTimeout(() => {
                      const activeElement = document.activeElement;
                      const dropdown = e.currentTarget.closest('.relative')?.querySelector('.absolute');
                      if (!dropdown?.contains(activeElement)) {
                        setShowCustomerDropdown(false);
                      }
                    }, 200);
                  }}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />

                {/* Customer/Patient Dropdown */}
                {showCustomerDropdown && (filteredCustomers.length > 0 || (isPharmacy && patients.length > 0)) && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                    {/* Customers */}
                    {filteredCustomers.slice(0, 8).map((customer) => {
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
                                {isAlsoPatient && (
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
                    
                    {/* Patients (Pharmacy mode only) - Filter out duplicates with customers */}
                    {isPharmacy && patients.length > 0 && (
                      <>
                        {filteredCustomers.length > 0 && (
                          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                            Patients (without customer record)
                          </div>
                        )}
                        {patients
                          .filter(patient => {
                            // Filter out patients where patient_name matches an existing customer name
                            const patientName = (patient.patient_name || patient.name).toLowerCase();
                            const matchesCustomer = filteredCustomers.some(
                              c => c.name.toLowerCase() === patientName
                            );
                            return !matchesCustomer;
                          })
                          .slice(0, 8)
                          .map((patient) => (
                            <button
                              key={patient.name}
                              onClick={() => handlePatientSelect(patient)}
                              className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                            >
                              <div className="flex items-center space-x-2">
                                <User className="w-4 h-4 text-blue-500" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                                    {patient.patient_name || patient.name}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {patient.patient_id && `ID: ${patient.patient_id}`}
                                    {patient.patient_id && patient.file_no && " • "}
                                    {patient.file_no && `File: ${patient.file_no}`}
                                  </div>
                                </div>
                              </div>
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
                title="Add New Customer"
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
                      {selectedCustomer?.name ?? (selectedPatient?.patient_name || selectedPatient?.name)}
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
                    {(selectedPatient || (selectedCustomer && isPharmacy)) ? (
                      <button
                        onClick={openMedicationOrdersModal}
                        className="p-1.5 rounded-md text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors"
                        title="View medication orders"
                      >
                        <Pill size={16} />
                    </button>
                  ) : null}
                    <button
                      onClick={() => {
                        setSelectedCustomer(null);
                        setSelectedPatient(null);
                        setCustomerSearchQuery("");
                        setUserRemovedDefaultCustomer(true);
                        setMedicationOrders([]);
                        setMedicationOrderHistory([]);
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
                  {selectedCustomer && selectedCustomer.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" && (
                    <span>{selectedCustomer.phone}</span>
                  )}
                  {selectedCustomer && selectedCustomer.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" && (customerStats?.total_orders || 0) > 0 && (
                    <span className="mx-2">•</span>
                  )}
                  {selectedCustomer && (customerStats?.total_orders || 0) > 0 && (
                    <span>{customerStats?.total_orders || 0} orders</span>
                  )}
                  {selectedCustomer && (!selectedCustomer.phone || selectedCustomer.phone === "N/A" || selectedCustomer.phone.trim() === "") && (customerStats?.total_orders || 0) === 0 && (
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
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search customers... (name, email, or phone)"
                value={customerSearchQuery}
                onChange={(e) => {
                  setCustomerSearchQuery(e.target.value);
                  setShowCustomerDropdown(e.target.value.length > 0);
                }}
                onKeyPress={handleCustomerSearchKeyDown}
                onFocus={() => setShowCustomerDropdown(true)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />

              {/* ADD THIS MISSING DROPDOWN - This was missing in mobile version */}
              {showCustomerDropdown && filteredCustomers.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {filteredCustomers.slice(0, 8).map((customer) => (
                    <button
                      key={customer.id}
                      onClick={() => handleCustomerSelect(customer)}
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
                        {/* {customer.status === "vip" && (
                          <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 rounded">
                            VIP
                          </span>
                        )} */}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowAddCustomerModal(true)}
              className="p-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
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
                    {selectedCustomer?.name ?? (selectedPatient?.patient_name || selectedPatient?.name)}
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
                  {(selectedPatient || (selectedCustomer && isPharmacy)) ? (
                    <button
                      onClick={openMedicationOrdersModal}
                      className="p-1.5 rounded-md text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors"
                      title="View medication orders"
                    >
                      <Pill size={18} />
                    </button>
                  ) : null}
                  <button
                    onClick={() => {
                      setSelectedCustomer(null);
                      setSelectedPatient(null);
                      setCustomerSearchQuery("");
                      setUserRemovedDefaultCustomer(true);
                      setMedicationOrders([]);
                      setMedicationOrderHistory([]);
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
                {selectedCustomer && selectedCustomer.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" && (
                  <span>{selectedCustomer.phone}</span>
                )}
                {selectedCustomer && selectedCustomer.phone && selectedCustomer.phone !== "N/A" && selectedCustomer.phone.trim() !== "" && (customerStats?.total_orders || 0) > 0 && (
                  <span className="mx-2">•</span>
                )}
                {selectedCustomer && (customerStats?.total_orders || 0) > 0 && (
                  <span>{customerStats?.total_orders || 0} orders</span>
                )}
                {selectedCustomer && (!selectedCustomer.phone || selectedCustomer.phone === "N/A" || selectedCustomer.phone.trim() === "") && (customerStats?.total_orders || 0) === 0 && (
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
                  dosage: 0,
                  ...(itemDiscounts[lineKey] || {}),
                  // Persisted batch survives refresh
                  ...(cartItemBatch !== undefined && cartItemBatch !== "" ? { batchNumber: cartItemBatch } : {}),
                  // Merge persisted + local serials instead of overwriting
                  ...(mergedSerialNumber ? { serialNumber: mergedSerialNumber } : {}),
                };

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

                    {/* Total Price - Fixed Width */}
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
                        {/* Row 1: Quantity | UOM */}
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
                              Quantity
                            </label>
                            <QuantityInput
                              item={item}
                              onUpdateQuantity={(_id, qty) => onUpdateQuantity(lineKey, qty)}
                              isMobile={isMobile}
                            />
                          </div>
                          <div>
                            <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
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
                        </div>

                        {/* Row 2: Discount Amount | Discount (%) */}
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
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
                              className={`w-full ${isMobile ? "text-sm" : "text-sm"} px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white`}
                            />
                          </div>
                          <div>
                            <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
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
                              className={`w-full ${isMobile ? "text-sm" : "text-sm"} px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white`}
                            />
                          </div>
                        </div>

                        {/* Row 3: Batch | Serial No */}
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
                              Batch
                            </label>
                            <BatchSelectField
                              itemId={lineKey}
                              itemCode={item.item_code || item.id}
                              options={itemBatches[item.item_code || item.id] || []}
                              value={itemDiscount.batchNumber || ""}
                              onChange={(selectedBatch, selectedQty) => {
                                updateItemDiscount(lineKey, "batchNumber", selectedBatch)
                                updateItemDiscount(lineKey, "availableQuantity", selectedQty)
                                updateItemMetadata(lineKey, { batch_no: selectedBatch || undefined })
                              }}
                              isMobile={isMobile}
                            />
                          </div>
                          <div>
                            <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
                              Serial No
                            </label>
                            <SerialSelectField
                              itemId={lineKey}
                              itemCode={item.item_code || item.id}
                              options={itemSerials[item.item_code || item.id] || []}
                              value={itemDiscount.serialNumber || ""}
                              onChange={(sn) => {
                                updateItemDiscount(lineKey, "serialNumber", sn)
                                updateItemMetadata(lineKey, { serial_no: sn || undefined })
                              }}
                              isMobile={isMobile}
                            />
                          </div>
                        </div>

                        {/* Row 4: Dosage | Prescription Frequency (Pharmacy only) */}
                        {isPharmacy && (
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
                                Dosage
                              </label>
                              <DosageInput
                                itemId={lineKey}
                                value={itemDiscount.dosage}
                                onChange={(_id, v) => updateItemDiscount(lineKey, "dosage", v)}
                                isMobile={isMobile}
                              />
                            </div>
                            <div>
                              <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
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

                        {/* Row 5: Item Tax Template | Additional Amount (side by side when allowed) */}
                        {(isItemTaxTemplateMode || isAllowAdditionalAmounts) && (
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            {isItemTaxTemplateMode && (
                              <div>
                                <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
                                  Item Tax Template
                                </label>
                                <select
                                  value={(item as { item_tax_template?: string }).item_tax_template || ""}
                                  onChange={(e) =>
                                    updateItemMetadata(lineKey, { item_tax_template: e.target.value || null })
                                  }
                                  className={`w-full ${isMobile ? "text-sm" : "text-sm"} px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white`}
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
                            {isAllowAdditionalAmounts && (
                              <div>
                                <label className={`block text-gray-700 dark:text-gray-300 font-medium ${isMobile ? "text-sm" : "text-sm"} mb-2`}>
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
                                  className={`w-full ${isMobile ? "text-sm" : "text-sm"} px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white`}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Discount Summary */}
                      {(itemDiscount.discountPercentage > 0 ||
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

          {/* Action Buttons */}
          <div
            className={`grid gap-3 ${isMobile ? "mb-3" : ""} ${
              isAllowAdditionalAmounts
                ? (isHospitalPharmacy ? "grid-cols-[1fr_auto]" : "grid-cols-[1fr_1fr_auto]")
                : (isHospitalPharmacy ? "grid-cols-1" : "grid-cols-2")
            }`}
          >
            {!isHospitalPharmacy && (
              <button
                onClick={() => {
                  if (!validateCustomer()) return;

                  const sc = selectedCustomer;
                  if (!sc) return;

                  const orderData = {
                    items: cartItems.map((item) => ({
                      id: item.id,
                      quantity: item.quantity,
                      price: getDiscountedPrice(item),
                    })),
                    customer: { id: sc.id },
                    subtotal,
                    total,
                    appliedCoupons,
                    itemDiscounts,
                    totalItemDiscount,
                    totalSavings: totalItemDiscount + couponDiscount,
                    status: "held",
                  };

                  handleHoldOrder(orderData);
                }}
                className="px-3 py-2 border border-beveren-600 text-beveren-600 dark:text-beveren-400 rounded-lg font-medium hover:bg-beveren-600 hover:text-white transition-colors text-sm"
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
            {isAllowAdditionalAmounts && (
              <button
                onClick={() => setShowAdditionalAmountModal(true)}
                className="px-3 py-2 border border-beveren-500 text-beveren-600 dark:text-beveren-400 rounded-lg font-medium hover:bg-beveren-50 dark:hover:bg-beveren-900/20 transition-colors text-sm flex items-center justify-center min-w-[44px]"
                title="Add misc amount (e.g. syringe)"
              >
                <Plus size={18} />
              </button>
            )}
          </div>



          {/* Pay Button */}
          <button
            onClick={handleDispense}
            disabled={isDispensing}
            className={`w-full bg-beveren-600 text-white rounded-xl font-semibold hover:bg-beveren-700 transition-colors ${
              isMobile ? "py-3 text-base" : "py-2 text-sm"
            } disabled:opacity-60`}
          >
            {isHospitalPharmacy ? (isDispensing ? "Dispensing..." : "Dispense ") : "Checkout "}
            {currency_symbol}
            {total.toFixed(3)}
          </button>
          {isHospitalPharmacy && lastDispensedSalesOrder && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => printSalesOrder(lastDispensedSalesOrder)}
                className="px-3 py-2 border border-beveren-600 text-beveren-600 rounded-lg font-medium hover:bg-beveren-50 transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Printer size={15} />
                Print Sales Order
              </button>
              <button
                type="button"
                onClick={handleStartNewOrder}
                className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors text-sm"
              >
                New Order
              </button>
            </div>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowRedeemLoyaltyModal(false)}>
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

  return {
    ...item,
    discountedPrice: getDiscountedPrice(item),
    // ✅ use lineKey, not item.id
    itemDiscount: {
      ...lineDiscount,
      // ✅ override serialNumber with merged value
      serialNumber: mergedSerial,
    },
    originalPrice: item.price,
    finalAmount: getDiscountedPrice(item) * item.quantity + itemAdditional,
    // ✅ also override serial_no on the item itself so backend gets full list
    serial_no: mergedSerial || undefined,
    // ✅ quantity must match number of serials for ERPNext validation
    quantity: mergedSerial
      ? Math.max(item.quantity, mergedSerial.split(",").filter(Boolean).length)
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

      {/* Additional Amount Modal */}
      {isAllowAdditionalAmounts && (
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

      {/* Inpatient Medication Orders Modal */}
      <InpatientMedicationOrdersModal
        isOpen={showMedicationOrdersModal}
        onClose={() => {
          setShowMedicationOrdersModal(false);
          setSelectedOrders(new Set());
          setSelectedHistoryItems(new Set());
        }}
        pendingOrders={medicationOrders}
        historyOrders={medicationOrderHistory}
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
        onCreateVisit={handleCreatePatientVisit}
        creatingVisit={isCreatingVisit}
        patientName={selectedPatient?.patient_name || selectedPatient?.name}
        patientId={selectedPatient?.name}
        isHospitalMode={isHospitalPharmacy}
      />
    </div>
  );
}
