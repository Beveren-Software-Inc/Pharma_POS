"use client"

import { useI18n } from "../hooks/useI18n"
import type { CartItem } from "../../types"

interface CartItemRowProps {
  item: CartItem
  onUpdateQty: (itemCode: string, newQty: number) => void
}

export default function CartItemRow({ item, onUpdateQty }: CartItemRowProps) {
  const { isRTL } = useI18n()
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qty = (item as any).qty ?? (item as any).quantity ?? 0
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imageSrc = (item as any).imageURL ?? (item as any).image
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameEn = (item as any).nameEn ?? (item as any).name
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameAr = (item as any).nameAr ?? (item as any).name

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center space-x-3">
        {/* Only show image if it exists */}
        {imageSrc && (
          <div className="w-12 h-12 rounded object-cover bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
            <img src={imageSrc as string} alt={nameEn as string} className="w-12 h-12 rounded object-cover" />
          </div>
        )}
        <div className={imageSrc ? "" : "flex-1"}>
          <div className="font-medium text-sm">{isRTL ? (nameAr as string) : (nameEn as string)}</div>
          <div className="text-xs text-gray-600">{isRTL ? (nameEn as string) : (nameAr as string)}</div>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <button
                //eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => onUpdateQty((item as any).item_code ?? item.id, qty - 1)}
          className="w-6 h-6 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center hover:bg-gray-200"
        >
          −
        </button>
        <span className="w-8 text-center font-medium">{qty}</span>
        <button
        //eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => onUpdateQty((item as any).item_code ?? item.id, qty + 1)}
          className="w-6 h-6 rounded-full bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center hover:bg-blue-100"
        >
          +
        </button>
      </div>

      <div className="text-gray-800 font-semibold">₨ {(item.price * qty).toFixed(2)}</div>
    </div>
  )
}
