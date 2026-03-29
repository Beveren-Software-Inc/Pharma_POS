// import { useState } from 'react'
// import { useProducts } from './useProducts'
// import type { MenuItem } from '../../types'

// export type ScanResult = boolean | { success: true; item_code: string; matched_type?: string; matched_value?: string }

// interface UseBarcodeScannerReturn {
//   scanBarcode: (barcode: string) => Promise<ScanResult>
//   isScanning: boolean
//   error: string | null
//   clearError: () => void
// }

// /** Callback can return a Promise so we wait for the add before applying batch/serial. */
// export function useBarcodeScanner(onAddToCart: (item: MenuItem) => void | Promise<unknown>): UseBarcodeScannerReturn {
//   const [isScanning, setIsScanning] = useState(false)
//   const [error, setError] = useState<string | null>(null)
//   const { products } = useProducts()

//   const clearError = () => setError(null)

//   const scanBarcode = async (barcode: string): Promise<ScanResult> => {
//     if (!barcode.trim()) {
//       setError('Please enter a valid barcode')
//       return false
//     }

//     setIsScanning(true)
//     setError(null)

//     try {
//       const foundItem = products.find(item => {
//         return item.id === barcode ||
//                item.name.toLowerCase().includes(barcode.toLowerCase())
//       })

//       if (foundItem) {
//         const addResult = onAddToCart(foundItem)
//         if (addResult && typeof (addResult as Promise<unknown>).then === 'function') {
//           await (addResult as Promise<unknown>)
//         }
//         return true
//       }

//       try {
//         const response = await fetch(`/api/method/klik_pos.api.item.get_item_by_identifier?code=${encodeURIComponent(barcode)}`)
//         const data = await response.json()

//         if (data.message && data.message.item_code) {
//           const item: MenuItem = {
//             id: data.message.item_code,
//             name: data.message.item_name || data.message.item_code,
//             category: data.message.item_group || 'General',
//             price: data.message.price || 0,
//             available: data.message.available || 0,
//             image: data.message.image,
//             sold: 0,
//             has_batch_no: data.message.has_batch_no,
//             has_serial_no: data.message.has_serial_no,
//           }
//           // Wait for add to finish so the new line is in the cart before we dispatch batch/serial
//           const addResult = onAddToCart(item)
//           if (addResult && typeof (addResult as Promise<unknown>).then === 'function') {
//             await (addResult as Promise<unknown>)
//           }
//           return {
//             success: true,
//             item_code: data.message.item_code,
//             matched_type: data.message.matched_type,
//             matched_value: data.message.matched_value,
//           }
//         } else {
//           setError('Product not found for this barcode')
//           return false
//         }
//       } catch (apiError) {
//         console.error('API error:', apiError)
//         setError('Product not found for this barcode')
//         return false
//       }
//     } catch (err) {
//       console.error('Barcode scanning error:', err)
//       setError('Error processing barcode')
//       return false
//     } finally {
//       setIsScanning(false)
//     }
//   }

//   return {
//     scanBarcode,
//     isScanning,
//     error,
//     clearError
//   }
// }

import { useState } from 'react'
import { useProducts } from './useProducts'
import { parseGS1, looksLikeGS1 } from './gS1parser'
import type { MenuItem } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GS1ScanMeta {
  gtin?: string
  expiryDate?: string
  lotNumber?: string
  serialNumber?: string
}

export type ScanResult =
  | false
  | {
      success: true
      item_code: string
      matched_type?: string
      matched_value?: string
      gs1?: GS1ScanMeta          // present when scanned code was a GS1 DataMatrix
    }

interface UseBarcodeScannerReturn {
  scanBarcode: (barcode: string) => Promise<ScanResult>
  isScanning: boolean
  error: string | null
  clearError: () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Enhanced barcode scanner that handles:
 *  1. Local product lookup (by id / name)
 *  2. Plain barcode / batch / serial via get_item_by_identifier
 *  3. GS1 DataMatrix codes (medical / retail packaging)
 *     → parses GTIN, Expiry, Lot, Serial from the compound string
 *     → looks up item by GTIN first, then falls back to lot/serial
 *     → returns lot + serial in the result so the caller can pre-fill
 *       batch-selection and serial-selection dialogs automatically
 */
export function useBarcodeScanner(
  onAddToCart: (item: MenuItem) => void | Promise<unknown>,
): UseBarcodeScannerReturn {
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const { products }                = useProducts()

  const clearError = () => setError(null)

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Wait for onAddToCart whether it returns void or a Promise. */
  async function addAndWait(item: MenuItem) {
    const r = onAddToCart(item)
    if (r && typeof (r as Promise<unknown>).then === 'function') await r
  }

  /** Call the Frappe API and return the message object, or null. */
  async function fetchItemByIdentifier(code: string) {
    const url = `/api/method/klik_pos.api.item.get_item_by_identifier?code=${encodeURIComponent(code)}`
    const res  = await fetch(url)
    const data = await res.json()
    return data?.message?.item_code ? data.message : null
  }

  /** Build a MenuItem from a Frappe API response object. */
  function messageToMenuItem(msg: Record<string, unknown>): MenuItem {
    return {
      id:            msg.item_code as string,
      name:          (msg.item_name as string) || (msg.item_code as string),
      category:      (msg.item_group as string) || 'General',
      price:         (msg.price as number)     || 0,
      available:     (msg.available as number) || 0,
      image:         msg.image as string | undefined,
      sold:          0,
      has_batch_no:  msg.has_batch_no as number | undefined,
      has_serial_no: msg.has_serial_no as number | undefined,
    }
  }

  // ── GS1 path ───────────────────────────────────────────────────────────────

  /**
   * Handle a GS1 DataMatrix scan.
   *
   * Strategy:
   *  a) Look up by GTIN (most reliable – it's the item's barcode)
   *  b) Fall back to Lot number
   *  c) Fall back to Serial number
   *
   * Once the item is found, add it to the cart and return lot + serial
   * in the result so upstream UI can auto-fill batch / serial dialogs.
   */
  async function handleGS1Scan(raw: string): Promise<ScanResult> {
    const gs1 = parseGS1(raw)

    if (!gs1.isGS1) return false // caller should try plain-barcode path

    const gs1Meta: GS1ScanMeta = {
      gtin:         gs1.gtin,
      expiryDate:   gs1.expiryDate,
      lotNumber:    gs1.lotNumber,
      serialNumber: gs1.serialNumber,
    }

    // Try identifiers in priority order: GTIN → Lot → Serial
    const candidates = [gs1.gtin, gs1.lotNumber, gs1.serialNumber].filter(Boolean) as string[]

    for (const candidate of candidates) {
      let msg: Record<string, unknown> | null = null

      try {
        msg = await fetchItemByIdentifier(candidate)
      } catch {
        continue
      }

      if (!msg) continue

      const item = messageToMenuItem(msg)
      await addAndWait(item)

      // If the GS1 code contained a lot/serial that the backend also matched,
      // prefer what the backend resolved; otherwise use what we parsed.
      const matched_type  = (msg.matched_type  as string | undefined) ?? (gs1.lotNumber ? 'batch' : gs1.serialNumber ? 'serial' : undefined)
      const matched_value = (msg.matched_value as string | undefined) ?? gs1.lotNumber ?? gs1.serialNumber

      return {
        success: true,
        item_code:    item.id,
        matched_type,
        matched_value,
        gs1:          gs1Meta,
      }
    }

    setError('Product not found for this GS1 code')
    return false
  }

  // ── Plain barcode path ─────────────────────────────────────────────────────

  async function handlePlainScan(barcode: string): Promise<ScanResult> {
    // 1) Local product list
    const foundItem = products.find(
      p => p.id === barcode || p.name.toLowerCase().includes(barcode.toLowerCase()),
    )
    if (foundItem) {
      await addAndWait(foundItem)
      return true
    }

    // 2) Remote API
    try {
      const msg = await fetchItemByIdentifier(barcode)
      if (!msg) {
        setError('Product not found for this barcode')
        return false
      }

      const item = messageToMenuItem(msg)
      await addAndWait(item)

      return {
        success:       true,
        item_code:     item.id,
        matched_type:  msg.matched_type  as string | undefined,
        matched_value: msg.matched_value as string | undefined,
      }
    } catch {
      setError('Product not found for this barcode')
      return false
    }
  }

  // ── Main entry point ───────────────────────────────────────────────────────

  const scanBarcode = async (barcode: string): Promise<ScanResult> => {
    if (!barcode.trim()) {
      setError('Please enter a valid barcode')
      return false
    }

    setIsScanning(true)
    setError(null)

    try {
      // Decide path: GS1 DataMatrix or plain barcode
      if (looksLikeGS1(barcode)) {
        const gs1Result = await handleGS1Scan(barcode)
        if (gs1Result !== false) return gs1Result
        // Fall through to plain scan if GS1 parse didn't find an item
      }

      return await handlePlainScan(barcode)
    } catch (err) {
      console.error('Barcode scanning error:', err)
      setError('Error processing barcode')
      return false
    } finally {
      setIsScanning(false)
    }
  }

  return { scanBarcode, isScanning, error, clearError }
}