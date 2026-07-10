import { toast } from "react-toastify";
import { extractErrorFromException } from "./errorExtraction";
import { cacheHeldDispenseOrder } from "./heldDispenseOrderCache";
import type { DraftLineDiscount } from "./draftInvoiceCache";
import type { CartItem, Customer } from "../../types";
import type { Patient } from "../services/patientService";
import { getDraftHospitalSalesOrder } from "../services/salesOrder";

type HoldPayload = {
  cart_items?: CartItem[];
  item_discounts?: Record<string, DraftLineDiscount>;
  patient?: Patient | null;
  dispense_remarks?: string;
  created_visit_ref?: { doctype: string; name: string } | null;
};

type DraftSalesOrderItem = {
  item_code: string;
  item_name?: string;
  qty: number;
  rate: number;
  uom?: string;
  batch_no?: string;
  serial_no?: string;
  custom_batch?: string;
  custom_dispensing_lot?: string;
  custom_dosage?: string;
  custom_prescription_frequency?: string;
};

function buildLineDiscountFromSoItem(item: DraftSalesOrderItem, lineKey: string): DraftLineDiscount | null {
  const batchNumber = item.custom_batch || item.batch_no || "";
  const serialNumber = item.serial_no || "";
  const dispensingLot = item.custom_dispensing_lot || "";
  const dosage = item.custom_dosage || "";
  const prescriptionDosage = item.custom_prescription_frequency || "";

  if (!batchNumber && !serialNumber && !dispensingLot && !dosage && !prescriptionDosage) {
    return null;
  }

  return {
    discountPercentage: 0,
    discountAmount: 0,
    batchNumber,
    serialNumber,
    dispensingLot,
    availableQuantity: 0,
    dosage: dosage || undefined,
    prescriptionDosage: prescriptionDosage || undefined,
  };
}

function mergeLineDiscounts(
  base: Record<string, DraftLineDiscount>,
  fromItems: Record<string, DraftLineDiscount>
): Record<string, DraftLineDiscount> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(fromItems)) {
    merged[key] = { ...merged[key], ...value };
  }
  return merged;
}

export async function addHeldDispenseOrderToCart(salesOrderName: string): Promise<boolean> {
  try {
    const data = await getDraftHospitalSalesOrder(salesOrderName);
    if (!data?.success) {
      throw new Error(data?.message || "Failed to load held dispense order");
    }

    const holdPayload = (data.hold_payload || {}) as HoldPayload;
    let cartItems: CartItem[] = holdPayload.cart_items || [];
    let lineDiscounts: Record<string, DraftLineDiscount> = { ...(holdPayload.item_discounts || {}) };

    const soLineDiscounts: Record<string, DraftLineDiscount> = {};
    if (Array.isArray(data.items)) {
      data.items.forEach((item, index) => {
        const lineKey =
          cartItems[index] &&
          ((cartItems[index] as CartItem & { cartLineId?: string }).cartLineId || cartItems[index].id)
            ? (cartItems[index] as CartItem & { cartLineId?: string }).cartLineId || cartItems[index].id
            : `${item.item_code}::${index}`;

        const discount = buildLineDiscountFromSoItem(item, lineKey);
        if (discount) {
          soLineDiscounts[lineKey] = discount;
        }
      });
    }

    lineDiscounts = mergeLineDiscounts(lineDiscounts, soLineDiscounts);

    if (!cartItems.length && Array.isArray(data.items)) {
      cartItems = data.items.map((item, index) => {
        const lineKey = `${item.item_code}::${index}`;
        const batchNo = item.custom_batch || item.batch_no || "";
        const serial = item.serial_no || "";
        const dispensingLot = item.custom_dispensing_lot || "";

        if (!lineDiscounts[lineKey]) {
          const discount = buildLineDiscountFromSoItem(item, lineKey);
          if (discount) {
            lineDiscounts[lineKey] = discount;
          }
        }

        return {
          id: item.item_code,
          name: item.item_name || item.item_code,
          category: "General",
          price: Number(item.rate) || 0,
          image: "",
          quantity: Number(item.qty) || 0,
          uom: item.uom,
          item_code: item.item_code,
          cartLineId: lineKey,
          batch_no: batchNo || undefined,
          serial_no: serial || undefined,
          dispensing_lot: dispensingLot || undefined,
          dosage: item.custom_dosage || undefined,
          prescriptionDosage: item.custom_prescription_frequency || undefined,
        };
      });
    } else if (Array.isArray(data.items) && cartItems.length) {
      cartItems = cartItems.map((item, index) => {
        const soItem = data.items?.[index];
        if (!soItem) return item;

        const batchNo = soItem.custom_batch || soItem.batch_no;
        const dispensingLot = soItem.custom_dispensing_lot;
        return {
          ...item,
          batch_no: batchNo || (item as CartItem & { batch_no?: string }).batch_no,
          serial_no: soItem.serial_no || (item as CartItem & { serial_no?: string }).serial_no,
          dispensing_lot: dispensingLot || (item as CartItem & { dispensing_lot?: string }).dispensing_lot,
          dosage: soItem.custom_dosage || item.dosage,
          prescriptionDosage: soItem.custom_prescription_frequency || item.prescriptionDosage,
        };
      });
    }

    if (!cartItems.length) {
      throw new Error("No items found in held dispense order");
    }

    const customer: Customer | null = data.customer
      ? ({
          id: data.customer,
          name: data.customer_name || data.customer,
          customer_name: data.customer_name || data.customer,
          email: "",
          email_id: "",
          phone: "",
          mobile_no: "",
          territory: "",
          customer_group: "",
          customer_type: "individual",
          type: "individual",
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
        } as Customer)
      : null;

    const patient: Patient | null =
      holdPayload.patient ||
      (data.patient
        ? { name: data.patient, patient_name: data.customer_name || data.patient }
        : null);

    cacheHeldDispenseOrder({
      items: cartItems,
      timestamp: Date.now(),
      salesOrderId: salesOrderName,
      customer,
      patient,
      lineDiscounts,
      dispenseRemarks: holdPayload.dispense_remarks || data.custom_remarks || "",
      createdVisitRef: holdPayload.created_visit_ref || null,
    });

    return true;
  } catch (error: unknown) {
    console.error("Error caching held dispense order:", error);
    toast.error(extractErrorFromException(error, "Failed to load held dispense order"));
    return false;
  }
}
