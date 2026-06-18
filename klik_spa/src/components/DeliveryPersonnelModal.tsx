// "use client";

// import { useState, useEffect, useMemo } from "react";
// import { X, Loader2, Search, ChevronDown } from "lucide-react";
// import { useDeliveryPersonnel } from "../hooks/useDeliveryPersonnel";
// import { useDeliveryChannels } from "../hooks/useDeliveryChannels";

// interface DeliveryPersonnelModalProps {
//   isOpen: boolean;
//   onClose: () => void;
//   onSelect: (selection: {
//     personnelName: string | null;
//     deliveryVia: string | null;
//     referenceNo?: string | null;
//     distanceKm?: number | null;
//     deliveryFee?: number | null;
//     amountWithVAT?: number | null;
//   }) => void;
//   /** Current order grand total (before delivery). Used for amount-threshold check: if total >= threshold, delivery is free. */
//   grandTotal?: number | null;
// }

// export default function DeliveryPersonnelModal({
//   isOpen,
//   onClose,
//   onSelect,
//   grandTotal,
// }: DeliveryPersonnelModalProps) {
//   const { channels, loading: channelsLoading, error: channelsError } = useDeliveryChannels();
//   const [selectedChannel, setSelectedChannel] = useState<string>("");
//   const [channelSearchQuery, setChannelSearchQuery] = useState<string>("");
//   const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState<boolean>(false);
//   const [referenceNo, setReferenceNo] = useState<string>("");

//   const { personnel, loading, error } = useDeliveryPersonnel(selectedChannel || null);
//   const [selectedPersonnel, setSelectedPersonnel] = useState<string>("");
//   const [personnelSearchQuery, setPersonnelSearchQuery] = useState<string>("");
//   const [isPersonnelDropdownOpen, setIsPersonnelDropdownOpen] = useState<boolean>(false);
//   const [distanceKm, setDistanceKm] = useState<string>("");
//   const [deliveryFee, setDeliveryFee] = useState<string>("");
//   const [deliveryFeeLoading, setDeliveryFeeLoading] = useState<boolean>(false);
//   const [deliveryFeeError, setDeliveryFeeError] = useState<string | null>(null);
//   const [requiresManualFee, setRequiresManualFee] = useState<boolean>(false);

//   const VAT_RATE = 0.10; // 10%
//   useEffect(() => {
//     if (isOpen) {
//       setSelectedChannel("");
//       setChannelSearchQuery("");
//       setReferenceNo("");
//       setSelectedPersonnel("");
//       setPersonnelSearchQuery("");
//       setDistanceKm("");
//       setDeliveryFee("");
//       setDeliveryFeeLoading(false);
//       setDeliveryFeeError(null);
//       setRequiresManualFee(false);
//       // Do not auto-open any dropdowns; let user click into the field first
//       setIsChannelDropdownOpen(false);
//       setIsPersonnelDropdownOpen(false);
//     } else {
//       setIsChannelDropdownOpen(false);
//       setIsPersonnelDropdownOpen(false);
//     }
//   }, [isOpen, channelsLoading]);

//   // Fetch suggested delivery fee from backend when personnel is selected and distance is entered
//   useEffect(() => {
//     const d = parseFloat(distanceKm);
//     if (!selectedPersonnel || !distanceKm.trim() || Number.isNaN(d) || d <= 0) {
//       setDeliveryFeeLoading(false);
//       setDeliveryFeeError(null);
//       setRequiresManualFee(false);
//       return;
//     }

//     let cancelled = false;
//     const run = async () => {
//       try {
//         setDeliveryFeeLoading(true);
//         setDeliveryFeeError(null);

//         let url = `/api/method/klik_pos.api.delivery_charges.get_delivery_fee?distance=${encodeURIComponent(
//           d.toString()
//         )}`;
//         if (grandTotal != null && !Number.isNaN(grandTotal)) {
//           url += `&grand_total=${encodeURIComponent(String(grandTotal))}`;
//         }
//         const res = await fetch(url, { credentials: "include" });
//         const data = await res.json();
//         if (cancelled) return;
//         const msg = data?.message || {};
//         if (msg.success && typeof msg.fee === "number") {
//           setDeliveryFee(msg.fee.toString());
//           setRequiresManualFee(!!msg.requires_manual);
//         } else {
//           setRequiresManualFee(true);
//           setDeliveryFeeError(
//             (msg && msg.error) || "Failed to fetch delivery fee. Please enter it manually."
//           );
//         }
//       } catch (err) {
//         if (cancelled) return;
//         console.error("Error fetching delivery fee:", err);
//         setRequiresManualFee(true);
//         setDeliveryFeeError("Failed to fetch delivery fee. Please enter it manually.");
//       } finally {
//         if (!cancelled) {
//           setDeliveryFeeLoading(false);
//         }
//       }
//     };

//     run();

//     return () => {
//       cancelled = true;
//     };
//   }, [selectedPersonnel, distanceKm, grandTotal]);

//   const filteredChannels = useMemo(() => {
//     if (!channelSearchQuery.trim()) return channels;
//     const q = channelSearchQuery.toLowerCase();
//     return channels.filter((c) => (c.delivery_via || c.name || "").toLowerCase().includes(q));
//   }, [channels, channelSearchQuery]);

//   const visiblePersonnel = useMemo(() => {
//     // If no channel is chosen, only show personnel that are NOT linked to any channel.
//     if (!selectedChannel) {
//       return personnel.filter((p) => !p.delivery_via);
//     }
//     return personnel;
//   }, [personnel, selectedChannel]);

//   // Filter personnel based on search query
//   const filteredPersonnel = useMemo(() => {
//     if (!personnelSearchQuery.trim()) return visiblePersonnel;
//     const query = personnelSearchQuery.toLowerCase();
//     return visiblePersonnel.filter(
//       (person) =>
//         person.delivery_personnel.toLowerCase().includes(query) ||
//         person.name.toLowerCase().includes(query)
//     );
//   }, [visiblePersonnel, personnelSearchQuery]);

//   const amountWithVAT = useMemo(() => {
//   const fee = parseFloat(deliveryFee);
//   if (Number.isNaN(fee)) return "";
//   return (fee * (1 + VAT_RATE)).toFixed(3);
// }, [deliveryFee]);

//   if (!isOpen) return null;

//   const handleSelectChannel = (channelName: string, channelDisplayName: string) => {
//     setSelectedChannel(channelName);
//     setChannelSearchQuery(channelDisplayName);
//     setIsChannelDropdownOpen(false);
//     // Reset personnel selection when channel changes
//     setSelectedPersonnel("");
//     setPersonnelSearchQuery("");
//     setIsPersonnelDropdownOpen(false);
//   };

//   const handleSelectPersonnel = (personnelName: string, personnelDisplayName: string) => {
//     setSelectedPersonnel(personnelName);
//     setPersonnelSearchQuery(personnelDisplayName);
//     setIsPersonnelDropdownOpen(false);
//   };

//   const handleConfirm = () => {
//     if (selectedPersonnel || selectedChannel || referenceNo.trim()) {
//       onSelect({
//         personnelName: selectedPersonnel || null,
//         deliveryVia: selectedChannel || null,
//         referenceNo: referenceNo.trim() || null,
//         distanceKm: distanceKm && !Number.isNaN(parseFloat(distanceKm)) ? parseFloat(distanceKm) : null,
//         deliveryFee: deliveryFee && !Number.isNaN(parseFloat(deliveryFee)) ? parseFloat(deliveryFee) : null,
//         amountWithVAT:amountWithVAT && !Number.isNaN(parseFloat(amountWithVAT))
//     ? parseFloat(amountWithVAT)
//     : null,
//       });
//       onClose();
//     }
//   };

//   const handleChannelInputChange = (value: string) => {
//     setChannelSearchQuery(value);
//     setIsChannelDropdownOpen(true);
//     const currentSelected = channels.find((c) => c.name === selectedChannel)?.delivery_via || selectedChannel;
//     if (value !== currentSelected) {
//       setSelectedChannel("");
//       setSelectedPersonnel("");
//       setPersonnelSearchQuery("");
//     }
//   };

//   const handlePersonnelInputChange = (value: string) => {
//     setPersonnelSearchQuery(value);
//     setIsPersonnelDropdownOpen(true);
//     // Clear selection if user is typing and it doesn't match the selected name
//     const currentSelectedName = personnel.find((p) => p.name === selectedPersonnel)?.delivery_personnel || "";
//     if (value !== currentSelectedName) {
//       setSelectedPersonnel("");
//     }
//   };

//   const handleChannelInputFocus = () => setIsChannelDropdownOpen(true);
//   const handlePersonnelInputFocus = () => setIsPersonnelDropdownOpen(true);

//   const handleChannelInputBlur = () => {
//     // As soon as focus leaves the input (cursor outside), hide the Delivery Channel dropdown
//     setTimeout(() => {
//       setIsChannelDropdownOpen(false);
//     }, 0);
//   };

//   const handlePersonnelInputBlur = (e: React.FocusEvent) => {
//     setTimeout(() => {
//       const activeElement = document.activeElement;
//       const wrapper = e.currentTarget.closest(".relative")?.parentElement;
//       const dropdown = wrapper?.querySelector(".absolute");
//       if (!dropdown?.contains(activeElement)) {
//         setIsPersonnelDropdownOpen(false);
//       }
//     }, 200);
//   };

  

//   return (
//     <div
//       className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 bg-opacity-50"
//       onClick={onClose}
//     >
//       <div
//         className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 delivery-personnel-modal-content"
//         onClick={(e) => e.stopPropagation()}
//       >
//         {/* Header */}
//         <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
//           <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
//             Select Delivery Personnel
//           </h2>
//           <button
//             onClick={onClose}
//             className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
//           >
//             <X size={20} />
//           </button>
//         </div>

//         {/* Content */}
//         <div className="p-4">
//           {channelsLoading ? (
//             <div className="flex items-center justify-center py-8">
//               <Loader2 size={24} className="animate-spin text-beveren-600" />
//               <span className="ml-2 text-gray-600 dark:text-gray-400">Loading...</span>
//             </div>
//           ) : channelsError ? (
//             <div className="text-red-600 dark:text-red-400 text-center py-8">
//               {channelsError}
//             </div>
//           ) : (
//             <div className="space-y-4">
//               {/* Delivery Channel */}
//               <div className="relative">
//                 <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
//                   Delivery Channel (optional)
//                 </div>
//                 <div className="relative">
//                   <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
//                   <input
//                     type="text"
//                     placeholder="Search delivery channel..."
//                     value={channelSearchQuery}
//                     onChange={(e) => handleChannelInputChange(e.target.value)}
//                     onFocus={handleChannelInputFocus}
//                     onMouseDown={() => setIsChannelDropdownOpen(true)}
//                     onBlur={handleChannelInputBlur}
//                     className="w-full pl-10 pr-10 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
//                   />
//                   <ChevronDown
//                     className={`absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-transform ${
//                       isChannelDropdownOpen ? "rotate-180" : ""
//                     }`}
//                     size={18}
//                   />
//                 </div>

//                 {isChannelDropdownOpen && (
//                   <div className="absolute z-10 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-hidden">
//                     <div className="max-h-64 overflow-y-auto">
//                       {filteredChannels.length > 0 ? (
//                         filteredChannels.map((c) => (
//                           <button
//                             key={c.name}
//                             type="button"
//                             onMouseDown={(e) => {
//                               // Use mousedown so selection happens before input blur closes the dropdown
//                               e.preventDefault();
//                               handleSelectChannel(c.name, c.delivery_via || c.name);
//                             }}
//                             className={`w-full text-left px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
//                               selectedChannel === c.name
//                                 ? "bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
//                                 : "text-gray-900 dark:text-white"
//                             }`}
//                           >
//                             <div className="font-medium">{c.delivery_via || c.name}</div>
//                           </button>
//                         ))
//                       ) : (
//                         <div className="px-4 py-3 text-gray-500 dark:text-gray-400 text-center">
//                           No matches found
//                         </div>
//                       )}
//                     </div>
//                   </div>
//                 )}
//               </div>

//               {/* Reference No (below Delivery Channel) */}
//               <div>
//                 <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
//                   Reference No (optional)
//                 </div>
//                 <input
//                   type="text"
//                   placeholder="Enter reference number..."
//                   value={referenceNo}
//                   onChange={(e) => setReferenceNo(e.target.value)}
//                   className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
//                 />
//               </div>

//               {/* Delivery Personnel (filtered by channel) */}
//               <div className="relative">
//                 <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
//                   Delivery Personnel
//                 </div>

//                 {!selectedChannel && (
//                   <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
//                     Showing personnel not linked to any delivery channel.
//                   </div>
//                 )}

//                 {loading ? (
//                   <div className="flex items-center justify-center py-6">
//                     <Loader2 size={20} className="animate-spin text-beveren-600" />
//                     <span className="ml-2 text-gray-600 dark:text-gray-400">Loading personnel...</span>
//                   </div>
//                 ) : error ? (
//                   <div className="text-red-600 dark:text-red-400 text-center py-6">
//                     {error}
//                   </div>
//                 ) : visiblePersonnel.length === 0 ? (
//                   <div className="text-gray-600 dark:text-gray-400 text-center py-6">
//                     {selectedChannel
//                       ? "No delivery personnel available for this channel"
//                       : "No unassigned delivery personnel available"}
//                   </div>
//                 ) : (
//                   <div className="relative">
//                     <div className="relative">
//                       <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
//                       <input
//                         type="text"
//                         placeholder="Search delivery personnel..."
//                         value={personnelSearchQuery}
//                         onChange={(e) => handlePersonnelInputChange(e.target.value)}
//                         onFocus={handlePersonnelInputFocus}
//                         onMouseDown={() => setIsPersonnelDropdownOpen(true)}
//                         onBlur={handlePersonnelInputBlur}
//                         className="w-full pl-10 pr-10 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
//                       />
//                       <ChevronDown
//                         className={`absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-transform ${
//                           isPersonnelDropdownOpen ? "rotate-180" : ""
//                         }`}
//                         size={18}
//                       />
//                     </div>

//                     {isPersonnelDropdownOpen && (
//                       <div className="absolute z-10 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-hidden">
//                         <div className="max-h-64 overflow-y-auto">
//                           {filteredPersonnel.length > 0 ? (
//                             filteredPersonnel.map((person) => (
//                               <button
//                                 key={person.name}
//                                 type="button"
//                                 onClick={() => handleSelectPersonnel(person.name, person.delivery_personnel)}
//                                 className={`w-full text-left px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
//                                   selectedPersonnel === person.name
//                                     ? "bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
//                                     : "text-gray-900 dark:text-white"
//                                 }`}
//                               >
//                                 <div className="font-medium">{person.delivery_personnel}</div>
//                               </button>
//                             ))
//                           ) : (
//                             <div className="px-4 py-3 text-gray-500 dark:text-gray-400 text-center">
//                               No matches found
//                             </div>
//                           )}
//                         </div>
//                       </div>
//                     )}
//                   </div>
//                 )}
//               </div>
//               {/* Delivery distance and fee - only show when personnel is selected */}
//               {selectedPersonnel && (
//                 <div className="space-y-3">
//                   <div>
//                     <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
//                       Delivery Distance (km)
//                     </div>
//                     <input
//                       type="number"
//                       min={0}
//                       step="0.1"
//                       placeholder="Enter distance in km..."
//                       value={distanceKm}
//                       onChange={(e) => setDistanceKm(e.target.value)}
//                       className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
//                     />
//                   </div>
//                   <div>
//                     <div className="flex items-center justify-between mb-1">
//                       <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
//                         Delivery Charge
//                       </div>
//                       {deliveryFeeLoading && (
//                         <span className="text-xs text-gray-500 dark:text-gray-400">
//                           Calculating...
//                         </span>
//                       )}
//                     </div>
//                     <input
//                       type="number"
//                       min={0}
//                       step="0.001"
//                       placeholder={
//                         requiresManualFee
//                           ? "Enter delivery charge manually..."
//                           : "Auto-calculated, you can adjust..."
//                       }
//                       value={deliveryFee}
//                       onChange={(e) => setDeliveryFee(e.target.value)}
//                       className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
//                     />
//                     <div>
//                           <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
//                             Amount + VAT (10%)
//                           </div>
//                           <input
//                             type="number"
//                             value={amountWithVAT}
//                             readOnly
//                             className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
//                           />
//                   </div>
//                     {deliveryFeeError && (
//                       <div className="mt-1 text-xs text-orange-500 dark:text-orange-400">
//                         {deliveryFeeError}
//                       </div>
//                     )}
//                   </div>
//                 </div>
//               )}
//             </div>
//           )}
//         </div>

//         {/* Footer */}
//         <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
//           <button
//             onClick={onClose}
//             className="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
//           >
//             Cancel
//           </button>
//           <button
//             onClick={handleConfirm}
//             disabled={(!selectedPersonnel && !selectedChannel && !referenceNo.trim()) || loading || channelsLoading}
//             className="px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
//           >
//             Confirm
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// }


"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Loader2, Search, ChevronDown, User, Truck } from "lucide-react";
import { useDeliveryPersonnel } from "../hooks/useDeliveryPersonnel";
import { useDeliveryChannels } from "../hooks/useDeliveryChannels";

interface DeliveryPersonnelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: {
    personnelName: string | null;
    deliveryVia: string | null;
    referenceNo?: string | null;
    distanceKm?: number | null;
    deliveryFee?: number | null;
    amountWithVAT?: number | null;
    remarks?: string | null;
  }) => void;
  /** Current order grand total (before delivery). Used for amount-threshold check: if total >= threshold, delivery is free. */
  grandTotal?: number | null;
}

type TabType = "personnel" | "channel";

export default function DeliveryPersonnelModal({
  isOpen,
  onClose,
  onSelect,
  grandTotal,
}: DeliveryPersonnelModalProps) {
  const { channels, loading: channelsLoading, error: channelsError } = useDeliveryChannels();
  const [activeTab, setActiveTab] = useState<TabType>("personnel");
  
  // Personnel state (Tab 1)
  const { personnel, loading, error } = useDeliveryPersonnel(null); // Remove channel filter
  const [selectedPersonnel, setSelectedPersonnel] = useState<string>("");
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState<string>("");
  const [isPersonnelDropdownOpen, setIsPersonnelDropdownOpen] = useState<boolean>(false);
  const [distanceKm, setDistanceKm] = useState<string>("");
  const [deliveryFee, setDeliveryFee] = useState<string>("");
  const [deliveryFeeLoading, setDeliveryFeeLoading] = useState<boolean>(false);
  const [deliveryFeeError, setDeliveryFeeError] = useState<string | null>(null);
  const [requiresManualFee, setRequiresManualFee] = useState<boolean>(false);
  
  // Channel state (Tab 2)
  const [selectedDeliveryChannel, setSelectedDeliveryChannel] = useState<string>("");
  const [channelReferenceNo, setChannelReferenceNo] = useState<string>("");
  const [channelSearchQuery, setChannelSearchQuery] = useState<string>("");
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState<boolean>(false);
  const [remarks, setRemarks] = useState<string>("");

  const VAT_RATE = 0.10; // 10%

  useEffect(() => {
    if (isOpen) {
      // Reset personnel state
      setSelectedPersonnel("");
      setPersonnelSearchQuery("");
      setDistanceKm("");
      setDeliveryFee("");
      setDeliveryFeeLoading(false);
      setDeliveryFeeError(null);
      setRequiresManualFee(false);
      
      // Reset channel state
      setSelectedDeliveryChannel("");
      setChannelReferenceNo("");
      setChannelSearchQuery("");
      setRemarks("");
      
      // Reset UI state
      setIsPersonnelDropdownOpen(false);
      setIsChannelDropdownOpen(false);
      setActiveTab("personnel");
    }
  }, [isOpen]);

  // Fetch suggested delivery fee from backend when personnel is selected and distance is entered
  useEffect(() => {
    const d = parseFloat(distanceKm);
    if (!selectedPersonnel || !distanceKm.trim() || Number.isNaN(d) || d <= 0) {
      setDeliveryFeeLoading(false);
      setDeliveryFeeError(null);
      setRequiresManualFee(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setDeliveryFeeLoading(true);
        setDeliveryFeeError(null);

        let url = `/api/method/klik_pos.api.delivery_charges.get_delivery_fee?distance=${encodeURIComponent(
          d.toString()
        )}`;
        if (grandTotal != null && !Number.isNaN(grandTotal)) {
          url += `&grand_total=${encodeURIComponent(String(grandTotal))}`;
        }
        const res = await fetch(url, { credentials: "include" });
        const data = await res.json();
        if (cancelled) return;
        const msg = data?.message || {};
        if (msg.success && typeof msg.fee === "number") {
          setDeliveryFee(msg.fee.toString());
          setRequiresManualFee(!!msg.requires_manual);
        } else {
          setRequiresManualFee(true);
          setDeliveryFeeError(
            (msg && msg.error) || "Failed to fetch delivery fee. Please enter it manually."
          );
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching delivery fee:", err);
        setRequiresManualFee(true);
        setDeliveryFeeError("Failed to fetch delivery fee. Please enter it manually.");
      } finally {
        if (!cancelled) {
          setDeliveryFeeLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [selectedPersonnel, distanceKm, grandTotal]);

  const filteredChannels = useMemo(() => {
    if (!channelSearchQuery.trim()) return channels;
    const q = channelSearchQuery.toLowerCase();
    return channels.filter((c) => (c.delivery_via || c.name || "").toLowerCase().includes(q));
  }, [channels, channelSearchQuery]);

  // Get all personnel (no channel filter)
  const allPersonnel = useMemo(() => {
    return personnel;
  }, [personnel]);

  const filteredPersonnel = useMemo(() => {
    if (!personnelSearchQuery.trim()) return allPersonnel;
    const query = personnelSearchQuery.toLowerCase();
    return allPersonnel.filter(
      (person) =>
        person.delivery_personnel.toLowerCase().includes(query) ||
        person.name.toLowerCase().includes(query)
    );
  }, [allPersonnel, personnelSearchQuery]);

  const amountWithVAT = useMemo(() => {
    const fee = parseFloat(deliveryFee);
    if (Number.isNaN(fee)) return "";
    return (fee * (1 + VAT_RATE)).toFixed(3);
  }, [deliveryFee]);

  if (!isOpen) return null;

  const handleSelectPersonnel = (personnelName: string, personnelDisplayName: string) => {
    setSelectedPersonnel(personnelName);
    setPersonnelSearchQuery(personnelDisplayName);
    setIsPersonnelDropdownOpen(false);
  };

  const handleSelectDeliveryChannel = (channelName: string, channelDisplayName: string) => {
    setSelectedDeliveryChannel(channelName);
    setChannelSearchQuery(channelDisplayName);
    setIsChannelDropdownOpen(false);
  };

  const handleConfirm = () => {
    if (activeTab === "personnel") {
      if (selectedPersonnel) {
        onSelect({
          personnelName: selectedPersonnel || null,
          deliveryVia: null,
          referenceNo: null,
          distanceKm: distanceKm && !Number.isNaN(parseFloat(distanceKm)) ? parseFloat(distanceKm) : null,
          deliveryFee: deliveryFee && !Number.isNaN(parseFloat(deliveryFee)) ? parseFloat(deliveryFee) : null,
          amountWithVAT: amountWithVAT && !Number.isNaN(parseFloat(amountWithVAT))
            ? parseFloat(amountWithVAT)
            : null,
          remarks: remarks.trim() || null,
        });
        onClose();
      }
    } else {
      if (selectedDeliveryChannel) {
        onSelect({
          personnelName: null,
          deliveryVia: selectedDeliveryChannel || null,
          referenceNo: channelReferenceNo.trim() || null,
          distanceKm: null,
          deliveryFee: null,
          amountWithVAT: null,
          remarks: remarks.trim() || null,
        });
        onClose();
      }
    }
  };

  const handlePersonnelInputChange = (value: string) => {
    setPersonnelSearchQuery(value);
    setIsPersonnelDropdownOpen(true);
    const currentSelectedName = personnel.find((p) => p.name === selectedPersonnel)?.delivery_personnel || "";
    if (value !== currentSelectedName) {
      setSelectedPersonnel("");
    }
  };

  const handleChannelInputChange = (value: string) => {
    setChannelSearchQuery(value);
    setIsChannelDropdownOpen(true);
    const currentSelected = channels.find((c) => c.name === selectedDeliveryChannel)?.delivery_via || selectedDeliveryChannel;
    if (value !== currentSelected) {
      setSelectedDeliveryChannel("");
    }
  };

  const handlePersonnelInputFocus = () => setIsPersonnelDropdownOpen(true);
  const handleChannelInputFocus = () => setIsChannelDropdownOpen(true);

  const handlePersonnelInputBlur = () => {
    setTimeout(() => {
      setIsPersonnelDropdownOpen(false);
    }, 200);
  };

  const handleChannelInputBlur = () => {
    setTimeout(() => {
      setIsChannelDropdownOpen(false);
    }, 200);
  };

  return (
    <div
      className="fixed inset-0 lg:left-20 z-50 flex items-center justify-center bg-black/70 bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 flex flex-col"
        style={{ height: "600px", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Fixed */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Delivery Options
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            >
              <X size={20} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveTab("personnel")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === "personnel"
                  ? "text-beveren-600 border-b-2 border-beveren-600 dark:text-beveren-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              <User size={18} />
              Delivery Personnel
            </button>
            <button
              onClick={() => setActiveTab("channel")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === "channel"
                  ? "text-beveren-600 border-b-2 border-beveren-600 dark:text-beveren-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              <Truck size={18} />
              Delivery Channels
            </button>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "personnel" ? (
            /* Tab 1: Delivery Personnel - Only personnel, distance, delivery charge, amount + VAT */
            <div className="space-y-4">
              {/* Delivery Personnel */}
              <div className="relative" style={{ position: "static" }}>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Delivery Personnel *
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={20} className="animate-spin text-beveren-600" />
                    <span className="ml-2 text-gray-600 dark:text-gray-400">Loading personnel...</span>
                  </div>
                ) : error ? (
                  <div className="text-red-600 dark:text-red-400 text-center py-6">
                    {error}
                  </div>
                ) : allPersonnel.length === 0 ? (
                  <div className="text-gray-600 dark:text-gray-400 text-center py-6">
                    No delivery personnel available
                  </div>
                ) : (
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
                      <input
                        type="text"
                        placeholder="Search delivery personnel..."
                        value={personnelSearchQuery}
                        onChange={(e) => handlePersonnelInputChange(e.target.value)}
                        onFocus={handlePersonnelInputFocus}
                        onBlur={handlePersonnelInputBlur}
                        className="w-full pl-10 pr-10 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                      />
                      <ChevronDown
                        className={`absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-transform ${
                          isPersonnelDropdownOpen ? "rotate-180" : ""
                        }`}
                        size={18}
                      />
                    </div>

                    {isPersonnelDropdownOpen && (
                      <div className="fixed z-[9999] mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl max-h-64 overflow-auto"
                        style={{
                          width: "calc(100% - 2rem)",
                          maxWidth: "352px",
                          left: "50%",
                          transform: "translateX(-50%)"
                        }}>
                        <div className="max-h-64 overflow-y-auto">
                          {filteredPersonnel.length > 0 ? (
                            filteredPersonnel.map((person) => (
                              <button
                                key={person.name}
                                type="button"
                                onMouseDown={() => handleSelectPersonnel(person.name, person.delivery_personnel)}
                                className={`w-full text-left px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                                  selectedPersonnel === person.name
                                    ? "bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
                                    : "text-gray-900 dark:text-white"
                                }`}
                              >
                                <div className="font-medium">{person.delivery_personnel}</div>
                              </button>
                            ))
                          ) : (
                            <div className="px-4 py-3 text-gray-500 dark:text-gray-400 text-center">
                              No matches found
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Delivery Distance */}
              {selectedPersonnel && (
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Delivery Distance (km)
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    placeholder="Enter distance in km..."
                    value={distanceKm}
                    onChange={(e) => setDistanceKm(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                  />
                </div>
              )}

              {/* Delivery Charge */}
              {selectedPersonnel && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Delivery Charge
                    </div>
                    {deliveryFeeLoading && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Calculating...
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    placeholder={
                      requiresManualFee
                        ? "Enter delivery charge manually..."
                        : "Auto-calculated, you can adjust..."
                    }
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                  />
                  {deliveryFeeError && (
                    <div className="mt-1 text-xs text-orange-500 dark:text-orange-400">
                      {deliveryFeeError}
                    </div>
                  )}
                </div>
              )}

              {/* Amount + VAT */}
              {selectedPersonnel && deliveryFee && (
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Amount + VAT (10%)
                  </div>
                  <input
                    type="number"
                    value={amountWithVAT}
                    readOnly
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              )}
            </div>
          ) : (
            /* Tab 2: Delivery Channels - Only channel and reference no */
            <div className="space-y-4">
              {/* Delivery Channel Selection */}
              <div className="relative" style={{ position: "static" }}>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Delivery Channel *
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
                  <input
                    type="text"
                    placeholder="Search delivery channel..."
                    value={channelSearchQuery}
                    onChange={(e) => handleChannelInputChange(e.target.value)}
                    onFocus={handleChannelInputFocus}
                    onBlur={handleChannelInputBlur}
                    className="w-full pl-10 pr-10 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                  />
                  <ChevronDown
                    className={`absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-transform ${
                      isChannelDropdownOpen ? "rotate-180" : ""
                    }`}
                    size={18}
                  />
                </div>

                {isChannelDropdownOpen && (
                  <div className="fixed z-[9999] mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl max-h-64 overflow-auto"
                    style={{
                      width: "calc(100% - 2rem)",
                      maxWidth: "352px",
                      left: "50%",
                      transform: "translateX(-50%)"
                    }}>
                    <div className="max-h-64 overflow-y-auto">
                      {filteredChannels.length > 0 ? (
                        filteredChannels.map((c) => (
                          <button
                            key={c.name}
                            type="button"
                            onMouseDown={() => handleSelectDeliveryChannel(c.name, c.delivery_via || c.name)}
                            className={`w-full text-left px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                              selectedDeliveryChannel === c.name
                                ? "bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
                                : "text-gray-900 dark:text-white"
                            }`}
                          >
                            <div className="font-medium">{c.delivery_via || c.name}</div>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-gray-500 dark:text-gray-400 text-center">
                          No matches found
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Reference No */}
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Reference No (optional)
                </div>
                <input
                  type="text"
                  placeholder="Enter reference number..."
                  value={channelReferenceNo}
                  onChange={(e) => setChannelReferenceNo(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                />
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Remarks</div>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="Delivery notes or instructions..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
        </div>

        {/* Footer - Fixed */}
        <div className="flex-shrink-0 flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              (activeTab === "personnel" && !selectedPersonnel) ||
              (activeTab === "channel" && !selectedDeliveryChannel) ||
              loading || channelsLoading
            }
            className="px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}