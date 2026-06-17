import { getDraftInvoiceItems } from '../services/salesInvoice';
import { toast } from 'react-toastify';
import { extractErrorFromException } from './errorExtraction';
import { cacheDraftInvoiceItems, type DraftLineDiscount } from './draftInvoiceCache';
import type { Customer } from '../../types';

export interface InvoiceItem {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  description?: string;
  batch_no?: string;
  serial_no?: string;
  custom_dispensing_lot?: string;
  uom?: string;
}

export interface CartItem {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
  quantity: number;
  uom?: string;
  available?: number;
  batch_no?: string;
  serial_no?: string;
  dispensing_lot?: string;
  cartLineId?: string;
}

export async function addDraftInvoiceToCart(invoiceId: string): Promise<boolean> {
  try {
    const invoiceData = await getDraftInvoiceItems(invoiceId);

    if (!invoiceData || !invoiceData.items || !Array.isArray(invoiceData.items)) {
      throw new Error('No items found in draft invoice');
    }

    const cartItems: CartItem[] = [];
    const lineDiscounts: Record<string, DraftLineDiscount> = {};

    for (const item of invoiceData.items as InvoiceItem[]) {
      const lineKey = `${item.item_code}::${cartItems.length}`;
      const cartItem: CartItem = {
        id: item.item_code,
        name: item.item_name,
        category: 'General',
        price: item.rate,
        image: '',
        quantity: item.qty,
        uom: item.uom,
        batch_no: item.batch_no || undefined,
        serial_no: item.serial_no || undefined,
        dispensing_lot: item.custom_dispensing_lot || undefined,
        cartLineId: lineKey,
      };
      cartItems.push(cartItem);

      if (item.batch_no || item.serial_no || item.custom_dispensing_lot) {
        lineDiscounts[lineKey] = {
          discountPercentage: 0,
          discountAmount: 0,
          batchNumber: item.batch_no || '',
          serialNumber: item.serial_no || '',
          dispensingLot: item.custom_dispensing_lot || '',
          availableQuantity: 0,
        };
      }
    }

    const customer: Customer | null = invoiceData.customer ? {
      id: invoiceData.customer,
      name: invoiceData.customer_name || invoiceData.customer,
      customer_name: invoiceData.customer_name || invoiceData.customer,
      email: invoiceData.customer_email || '',
      email_id: invoiceData.customer_email || '',
      phone: invoiceData.customer_mobile_no || '',
      mobile_no: invoiceData.customer_mobile_no || '',
      territory: '',
      customer_group: '',
      customer_type: 'individual',
      type: 'individual' as const,
      address: {
        addressType: 'Billing' as const,
        street: invoiceData.customer_address_line1 || '',
        city: invoiceData.customer_city || '',
        state: invoiceData.customer_state || '',
        zipCode: invoiceData.customer_pincode || '',
        country: invoiceData.customer_country || 'Saudi Arabia',
      },
      status: 'active' as const,
      preferredPaymentMethod: 'Cash' as const,
      loyaltyPoints: 0,
      totalSpent: 0,
      totalOrders: 0,
      tags: [],
      createdAt: new Date().toISOString(),
    } : null;

    cacheDraftInvoiceItems(invoiceId, cartItems, customer, lineDiscounts);

    return true;

  } catch (error: unknown) {
    console.error('Error caching draft invoice items:', error);
    const errorMessage = extractErrorFromException(error, 'Failed to cache draft invoice items');
    toast.error(errorMessage);
    return false;
  }
}
