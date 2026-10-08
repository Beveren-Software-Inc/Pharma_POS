import { getDraftInvoiceItems } from '../services/salesInvoice';
import { toast } from 'react-toastify';
import { extractErrorFromException } from './errorExtraction';
import { cacheDraftInvoiceItems, type DraftLineDiscount, type HeldDeliveryDetails } from './draftInvoiceCache';
import { clearPendingDelivery, deliveryAmountWithVat, setPendingDelivery } from './deliverySelection';
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
  dispensing_lot_serials?: string;
  uom?: string;
  is_delivery_charge?: number | boolean;
  item_tax_template?: string | null;
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
  item_tax_template?: string | null;
}

export async function addDraftInvoiceToCart(invoiceId: string): Promise<boolean> {
  try {
    const invoiceData = await getDraftInvoiceItems(invoiceId);

    if (!invoiceData || !invoiceData.items || !Array.isArray(invoiceData.items)) {
      throw new Error('No items found in draft invoice');
    }

    const cartItems: CartItem[] = [];
    const lineDiscounts: Record<string, DraftLineDiscount> = {};
    let deliveryChargeAmount = 0;
    let deliveryDistanceKm: number | null = null;

    for (const item of invoiceData.items as InvoiceItem[]) {
      const description = item.description || "";
      const isDeliveryCharge =
        Boolean(item.is_delivery_charge) ||
        item.item_name === "Delivery Charge" ||
        item.item_code === "Delivery Charge" ||
        description.startsWith("Delivery Charge");
      if (isDeliveryCharge) {
        deliveryChargeAmount += Number(item.rate) || 0;
        const distanceMatch = description.match(/Delivery Charge \(([0-9.]+) km\)/i);
        if (distanceMatch) {
          const parsed = Number(distanceMatch[1]);
          if (Number.isFinite(parsed)) deliveryDistanceKm = parsed;
        }
        continue;
      }
      const lineKey = `${item.item_code}::${cartItems.length}`;
      const serialForLot = item.dispensing_lot_serials || item.serial_no || "";
      const cartItem: CartItem = {
        id: item.item_code,
        name: item.item_name,
        category: 'General',
        price: item.rate,
        image: '',
        quantity: item.qty,
        uom: item.uom,
        batch_no: item.batch_no || undefined,
        serial_no: serialForLot || undefined,
        dispensing_lot: item.custom_dispensing_lot || undefined,
        cartLineId: lineKey,
        item_tax_template: item.item_tax_template || undefined,
      };
      cartItems.push(cartItem);

      if (item.batch_no || serialForLot || item.custom_dispensing_lot) {
        lineDiscounts[lineKey] = {
          discountPercentage: 0,
          discountAmount: 0,
          batchNumber: item.batch_no || '',
          serialNumber: serialForLot,
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

    const deliveryPersonnel = (invoiceData.custom_delivery_personnel as string) || null;
    const deliveryVia = (invoiceData.custom_delivery_via as string) || null;
    const referenceNo = (invoiceData.custom_reference_no as string) || null;
    const delivery: HeldDeliveryDetails | null =
      deliveryPersonnel || deliveryVia || referenceNo || deliveryChargeAmount > 0
        ? {
            deliveryPersonnel,
            deliveryPersonnelName: (invoiceData.custom_delivery_personnel_name as string) || null,
            deliveryVia,
            referenceNo,
            deliveryDistanceKm,
            deliveryChargeAmount,
            deliveryChargeWithVAT: deliveryAmountWithVat(deliveryChargeAmount),
          }
        : null;

    if (delivery) {
      setPendingDelivery({
        deliveryPersonnel: delivery.deliveryPersonnel,
        deliveryVia: delivery.deliveryVia,
        referenceNo: delivery.referenceNo,
        deliveryDistanceKm: delivery.deliveryDistanceKm,
        deliveryChargeAmount: delivery.deliveryChargeAmount,
        deliveryChargeWithVAT: delivery.deliveryChargeWithVAT,
        deliveryRemarks: null,
      });
    } else {
      clearPendingDelivery();
    }

    cacheDraftInvoiceItems(invoiceId, cartItems, customer, lineDiscounts, delivery);

    return true;

  } catch (error: unknown) {
    console.error('Error caching draft invoice items:', error);
    const errorMessage = extractErrorFromException(error, 'Failed to cache draft invoice items');
    toast.error(errorMessage);
    return false;
  }
}
