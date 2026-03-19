import { useState } from 'react'
import { useProducts } from './useProducts'
import type { MenuItem } from '../../types'

export type ScanResult = boolean | { success: true; item_code: string; matched_type?: string; matched_value?: string }

interface UseBarcodeScannerReturn {
  scanBarcode: (barcode: string) => Promise<ScanResult>
  isScanning: boolean
  error: string | null
  clearError: () => void
}

/** Callback can return a Promise so we wait for the add before applying batch/serial. */
export function useBarcodeScanner(onAddToCart: (item: MenuItem) => void | Promise<unknown>): UseBarcodeScannerReturn {
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { products } = useProducts()

  const clearError = () => setError(null)

  const scanBarcode = async (barcode: string): Promise<ScanResult> => {
    if (!barcode.trim()) {
      setError('Please enter a valid barcode')
      return false
    }

    setIsScanning(true)
    setError(null)

    try {
      const foundItem = products.find(item => {
        return item.id === barcode ||
               item.name.toLowerCase().includes(barcode.toLowerCase())
      })

      if (foundItem) {
        const addResult = onAddToCart(foundItem)
        if (addResult && typeof (addResult as Promise<unknown>).then === 'function') {
          await (addResult as Promise<unknown>)
        }
        return true
      }

      try {
        const response = await fetch(`/api/method/klik_pos.api.item.get_item_by_identifier?code=${encodeURIComponent(barcode)}`)
        const data = await response.json()

        if (data.message && data.message.item_code) {
          const item: MenuItem = {
            id: data.message.item_code,
            name: data.message.item_name || data.message.item_code,
            category: data.message.item_group || 'General',
            price: data.message.price || 0,
            available: data.message.available || 0,
            image: data.message.image,
            sold: 0,
            has_batch_no: data.message.has_batch_no,
            has_serial_no: data.message.has_serial_no,
          }
          // Wait for add to finish so the new line is in the cart before we dispatch batch/serial
          const addResult = onAddToCart(item)
          if (addResult && typeof (addResult as Promise<unknown>).then === 'function') {
            await (addResult as Promise<unknown>)
          }
          return {
            success: true,
            item_code: data.message.item_code,
            matched_type: data.message.matched_type,
            matched_value: data.message.matched_value,
          }
        } else {
          setError('Product not found for this barcode')
          return false
        }
      } catch (apiError) {
        console.error('API error:', apiError)
        setError('Product not found for this barcode')
        return false
      }
    } catch (err) {
      console.error('Barcode scanning error:', err)
      setError('Error processing barcode')
      return false
    } finally {
      setIsScanning(false)
    }
  }

  return {
    scanBarcode,
    isScanning,
    error,
    clearError
  }
}
