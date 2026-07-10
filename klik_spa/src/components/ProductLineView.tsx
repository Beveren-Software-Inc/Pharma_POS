"use client"

// import { useI18n } from "../hooks/useI18n"
import { usePOSDetails } from "../hooks/usePOSProfile"
import { useItemHoverTooltip } from "../hooks/useItemHoverTooltip"
import { itemHasBatchNo } from "../utils/batch"
import PharmacyItemDetailsModal from "./PharmacyItemDetailsModal"
import type { MenuItem } from "../../types"

interface ProductLineViewProps {
  items: MenuItem[]
  onAddToCart: (item: MenuItem) => void
  isMobile?: boolean
  scannerOnly?: boolean
}

export default function ProductLineView({ items, onAddToCart, isMobile = false, scannerOnly = false }: ProductLineViewProps) {
  // const { t } = useI18n()
  const { posDetails } = usePOSDetails()
  const isPharmacy = posDetails?.custom_is_pharmacy === 1 ||
                     posDetails?.custom_is_pharmacy === true ||
                     posDetails?.custom_is_pharmacy === "1"
  const {
    hoverItem,
    showTooltip,
    itemShowsHoverTooltip,
    openHoverTooltip,
    closeHoverTooltip,
    dismissHoverTooltip,
  } = useItemHoverTooltip(isPharmacy)

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No items found</h3>
          <p className="text-gray-500 dark:text-gray-400">Try adjusting your search or filters</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${isMobile ? "p-4" : "p-2"} bg-gray-50 dark:bg-gray-900`}>
      {/* Header Row */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 mb-4 overflow-hidden">
        <div className={`${isMobile ? "grid grid-cols-8 gap-2 px-3 py-3" : "grid grid-cols-12 gap-4 px-4 py-3"} bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600`}>
          <div className={`${isMobile ? "col-span-3" : "col-span-4"}`}>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Product</span>
          </div>
          <div className={`${isMobile ? "col-span-2" : "col-span-2"} text-center`}>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Rate</span>
          </div>
          <div className={`${isMobile ? "col-span-2" : isPharmacy ? "col-span-1" : "col-span-2"} text-center`}>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Qty</span>
          </div>
          {!isMobile && !isPharmacy && (
            <div className="col-span-2 text-center">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">UOM</span>
            </div>
          )}
          {!isMobile && isPharmacy && (
            <>
              <div className="col-span-1 text-center">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Strength</span>
              </div>
              <div className="col-span-1 text-center">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">No of Pack</span>
              </div>
              <div className="col-span-2 text-center">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Active Organic</span>
              </div>
            </>
          )}
          <div className={`${isMobile ? "col-span-1" : isPharmacy ? "col-span-1" : "col-span-2"} text-center`}>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Action</span>
          </div>
        </div>

        {/* Product Rows */}
        <div className="divide-y divide-gray-200 dark:divide-gray-600">
          {items.map((item) => {
            const isOutOfStock = item.available <= 0
            const isDisabled = isOutOfStock || scannerOnly
            const formattedPrice = `${item.currency_symbol}${item.price.toFixed(3)}`
            
            const itemData = item as MenuItem & {
              custom_strength?: string | null
              custom_pharmaceutical_form?: string | null
              custom_number_of_pack?: number | null
              custom_pack_size?: string | null
              custom_route_of_administration?: string | null
            }
            const showHoverTooltip = itemShowsHoverTooltip(itemData)

            return (
              <div
                key={item.id}
                className={`${isMobile ? "grid grid-cols-8 gap-2 px-3 py-3" : "grid grid-cols-12 gap-4 px-4 py-3"} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  isDisabled ? "opacity-60" : "cursor-pointer"
                }`}
                onClick={() => !isDisabled && onAddToCart(item)}
                onMouseEnter={() => openHoverTooltip(itemData)}
                onMouseLeave={closeHoverTooltip}
                data-item-hover-target={showHoverTooltip ? "true" : undefined}
                data-pharmacy-item={showHoverTooltip ? "true" : undefined}
              >
                {/* Product Name */}
                <div className={`${isMobile ? "col-span-3" : "col-span-4"} flex items-start`}>
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-medium text-gray-900 dark:text-white ${isMobile ? "text-xs leading-tight" : "text-sm"} ${
                      isMobile ? "break-words" : "truncate"
                    }`}>
                      {item.name}
                    </h3>
                    <p className={`text-gray-400 dark:text-gray-500 ${isMobile ? "text-[10px] leading-tight" : "text-xs"} ${
                      isMobile ? "break-words" : "truncate"
                    }`}>
                      {item.id}
                    </p>
                    <p className={`text-gray-500 dark:text-gray-400 ${isMobile ? "text-xs leading-tight" : "text-sm"} ${
                      isMobile ? "break-words" : "truncate"
                    }`}>
                      {item.category}
                    </p>
                  </div>
                </div>

                {/* Rate */}
                <div className={`${isMobile ? "col-span-2" : "col-span-2"} flex items-center justify-center`}>
                  <span className={`font-semibold text-beveren-600 dark:text-beveren-400 ${isMobile ? "text-xs" : "text-sm"}`}>
                    {formattedPrice}
                  </span>
                </div>

                {/* Available Qty */}
                <div className={`${isMobile ? "col-span-2" : isPharmacy ? "col-span-1" : "col-span-2"} flex items-center justify-center`}>
                  <span className={`font-medium ${isMobile ? "text-xs" : "text-sm"} ${
                    isOutOfStock
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-900 dark:text-white"
                  }`}>
                    {isOutOfStock ? "0" : item.available}
                  </span>
                </div>

                {/* UOM - Desktop only (non-pharmacy) */}
                {!isMobile && !isPharmacy && (
                  <div className="col-span-2 flex items-center justify-center">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {item.uom || "Nos"}
                    </span>
                  </div>
                )}

                {/* Strength + Active Organic - Desktop only (pharmacy) */}
                {!isMobile && isPharmacy && (
                  <>
                    <div className="col-span-1 flex items-center justify-center">
                      <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                        {(item as any).custom_strength || "-"}
                      </span>
                    </div>
                    <div className="col-span-1 flex items-center justify-center">
                      <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                        {(item as any).custom_number_of_pack ?? "-"}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-center">
                      <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                        {(item as any).custom_active_substances || "-"}
                      </span>
                    </div>
                  </>
                )}

                {/* Action */}
                <div className={`${isMobile ? "col-span-1" : isPharmacy ? "col-span-1" : "col-span-2"} flex items-center justify-center`}>
                  {isDisabled ? (
                    <span className={`text-gray-400 dark:text-gray-500 ${isMobile ? "text-xs" : "text-xs"}`}>
                      {isOutOfStock ? "0" : "S"}
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddToCart(item)
                      }}
                      className={`bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium rounded-md transition-colors hover:bg-slate-200 dark:hover:bg-slate-600 hover:border-slate-400 dark:hover:border-slate-500 ${
                        isMobile ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
                      }`}
                    >
                      {isMobile ? "+" : "Add"}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      
      {hoverItem && (
        <PharmacyItemDetailsModal
          isOpen={showTooltip}
          onClose={dismissHoverTooltip}
          itemName={hoverItem.name}
          itemCode={hoverItem.id}
          hasBatchNo={itemHasBatchNo(hoverItem)}
          custom_strength={hoverItem.custom_strength}
          custom_pharmaceutical_form={hoverItem.custom_pharmaceutical_form}
          custom_number_of_pack={hoverItem.custom_number_of_pack}
          custom_pack_size={hoverItem.custom_pack_size}
          custom_route_of_administration={hoverItem.custom_route_of_administration}
          position="right"
        />
      )}
    </div>
  )
}
