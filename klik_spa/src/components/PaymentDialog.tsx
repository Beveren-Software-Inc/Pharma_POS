"use client";

import { useState, useEffect, useMemo } from "react";
import {

  subtractCurrency,
  calculateRemainingAmount,
  calculateTotalPayments,
  roundCurrency,

} from "../utils/currencyMath";
import { getUserFriendlyError } from "../utils/errorMessages";
import { extractErrorFromException } from "../utils/errorExtraction";
import {
  X,
  CreditCard,
  Banknote,
  Smartphone,
  Gift,
  Printer,
  Eye,
  Calculator,
  Check,
  MessageCirclePlus,
  MailPlus,
  MessageSquarePlus,
  Loader2,
  Pencil,
  CheckCircle,
  ChevronDown
} from "lucide-react";
import type { CartItem, GiftCoupon } from "../../types";
import type { Customer } from "../types/customer";
import { toast } from "react-toastify";
import { usePaymentModes } from "../hooks/usePaymentModes";
import { useSalesTaxCharges } from "../hooks/useSalesTaxCharges";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { createDraftSalesInvoice } from "../services/salesInvoice";
import { createSalesInvoice } from "../services/salesInvoice";
import { useNavigate } from "react-router-dom";
import DisplayPrintPreview from "../utils/invoicePrint";
import { handlePrintInvoice } from "../utils/printHandler";
import { sendEmails, sendWhatsAppMessage, sendSMSMessage } from "../services/useSharing";
import { clearDraftInvoiceCache, getOriginalDraftInvoiceId } from "../utils/draftInvoiceCache";
// import { deleteDraftInvoice } from "../services/salesInvoice";
import {
  fetchWhatsAppTemplates,
  getDefaultWhatsAppTemplate,
  processTemplate,
  getDefaultMessageTemplate,
  type WhatsAppTemplate
} from "../services/whatsappTemplateService";
import {
  fetchEmailTemplates,
  getDefaultEmailTemplate,
  processEmailTemplate,
  getDefaultEmailMessageTemplate,
  type EmailTemplate
} from "../services/emailTemplateService";
import DeliveryPersonnelModal from "./DeliveryPersonnelModal";
import InsuranceModal, { type HealthInsuranceOption } from "./InsuranceModal";
import { useDeliveryPersonnel } from "../hooks/useDeliveryPersonnel";
import { useDeliveryChannels } from "../hooks/useDeliveryChannels";
import { useItemTaxTemplateRates } from "../hooks/useItemTaxTemplateRates";
import { useFreeItemTaxAmount } from "../hooks/useFreeItemTaxAmount";

interface PaymentDialogProps {
  isOpen: boolean;
  onClose: (paymentCompleted?: boolean) => void;
  cartItems: CartItem[];
  appliedCoupons: GiftCoupon[];
  selectedCustomer: Customer | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCompletePayment: (paymentData: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onHoldOrder: (orderData: any) => void;
  isMobile?: boolean;
  isFullPage?: boolean;
  initialSharingMode?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  externalInvoiceData?: any; // For invoice sharing
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  itemDiscounts?: any; // Batch and discount information
  totalItemDiscount?: number;
  /** Loyalty points to redeem at checkout (from Redeem modal); amount_to_pay = grandTotal - loyalty_amount */
  redeemLoyaltyPoints?: number | null;
  /** General additional amount (e.g. syringe, misc) - only when POS allows */
  generalAdditionalAmount?: number;
  /** Remark for additional amounts (comes from AdditionalAmountModal) */
  additionalRemark?: string | null;
}

interface PaymentMethod {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  enabled: boolean;
  amount: number;
}

interface PaymentAmount {
  [key: string]: number;
}

const getIconAndColor = (
  label: string
): { icon: React.ReactNode; color: string } => {
  const lowerLabel = label.toLowerCase();

  if (lowerLabel.includes("cash")) {
    return { icon: <Banknote size={24} />, color: "bg-beveren-600" };
  }
  if (
    lowerLabel.includes("card") ||
    lowerLabel.includes("credit") ||
    lowerLabel.includes("debit") ||
    lowerLabel.includes("bank")
  ) {
    return { icon: <CreditCard size={24} />, color: "bg-beveren-600" };
  }
  if (lowerLabel.includes("phone") || lowerLabel.includes("mpesa")) {
    return { icon: <Smartphone size={24} />, color: "bg-beveren--600" };
  }
  if (lowerLabel.includes("gift")) {
    return { icon: <Gift size={24} />, color: "bg-beveren--600" };
  }
  if (lowerLabel.includes("cheque") || lowerLabel.includes("check")) {
    return { icon: <Check size={24} />, color: "bg-beveren--600" };
  }

  return { icon: <CreditCard size={24} />, color: "bg-beveren--600" };
};

export default function PaymentDialog({
  isOpen,
  onClose,
  cartItems,
  appliedCoupons,
  selectedCustomer,

  onHoldOrder,
  isMobile = false,
  isFullPage = false,
  initialSharingMode = null,
  externalInvoiceData = null,
  itemDiscounts = {},
  redeemLoyaltyPoints = null,
  generalAdditionalAmount = 0,
  additionalRemark = null,
}: PaymentDialogProps) {
  const [selectedSalesTaxCharges, setSelectedSalesTaxCharges] = useState("");
  const [paymentAmounts, setPaymentAmounts] = useState<PaymentAmount>({});
  const [activeMethodId, setActiveMethodId] = useState<string | null>(null);
  // Track which payment method was last modified for round-off targeting
  const [, setLastModifiedMethodId] = useState<string | null>(null);
  const [roundOffAmount, setRoundOffAmount] = useState(0);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [isHoldingOrder, setIsHoldingOrder] = useState(false);
  const [invoiceSubmitted, setInvoiceSubmitted] = useState(false);
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [submittedInvoice, setSubmittedInvoice] = useState<any>(null);
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [invoiceData, setInvoiceData] = useState<any>(null);
  const [roundOffInput, setRoundOffInput] = useState(roundOffAmount.toFixed(3));
  const [isAutoPrinting, setIsAutoPrinting] = useState(false);
  const [sharingMode, setSharingMode] = useState<string | null>(
    initialSharingMode
  ); // 'email', 'sms', 'whatsapp'
  const [sharingData, setSharingData] = useState({
    email: selectedCustomer?.email || "",
    phone: selectedCustomer?.phone || "",
    name: selectedCustomer?.name || "",
  });

  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isSendingWhatsapp, setIsSendingWhatsapp] = useState(false);

  // Loyalty redemption preview (amount_to_pay = grandTotal - loyalty_amount)
  const [loyaltyPreview, setLoyaltyPreview] = useState<{ loyalty_amount: number; amount_to_pay: number } | null>(null);

  // WhatsApp template states
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsAppTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  const [customMessage, setCustomMessage] = useState("");
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isEditingWhatsapp, setIsEditingWhatsapp] = useState(false);

  // Email template states
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState<EmailTemplate | null>(null);
  const [emailMessage, setEmailMessage] = useState("");
  const [isLoadingEmailTemplates, setIsLoadingEmailTemplates] = useState(false);
  const [isEditingEmail, setIsEditingEmail] = useState(false);

  // Delivery personnel states (optional, user-controlled via footer field)
  const [showDeliveryPersonnelModal, setShowDeliveryPersonnelModal] = useState(false);
  const [selectedDeliveryPersonnel, setSelectedDeliveryPersonnel] = useState<string | null>(null);
  const [selectedDeliveryVia, setSelectedDeliveryVia] = useState<string | null>(null);
  const [selectedReferenceNo, setSelectedReferenceNo] = useState<string | null>(null);
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState<number | null>(null);
  const [deliveryChargeAmount, setDeliveryChargeAmount] = useState<number | null>(null);
  const [deliveryChargeTaxAmount, setDeliveryChargeTaxAmount] = useState<number | null>(null);
  // When true, this is a company delivery via channel only (pay later, no POS payment now)
  const [isCompanyDelivery, setIsCompanyDelivery] = useState(false);

  // Insurance (Health Insurance): optional split of payment
  const [showInsuranceModal, setShowInsuranceModal] = useState(false);
  const [selectedHealthInsurance, setSelectedHealthInsurance] = useState<HealthInsuranceOption | null>(null);

  // Hooks
  const { posDetails, loading: posLoading } = usePOSDetails();
  const { modes, isLoading, error } = usePaymentModes(typeof posDetails?.name === 'string' ? posDetails.name : '');
  const { salesTaxCharges, defaultTax } = useSalesTaxCharges();
  const { personnel: deliveryPersonnelList } = useDeliveryPersonnel();
  const { channels: deliveryChannels } = useDeliveryChannels();
  const navigate = useNavigate();

  // Determine if this is B2B business type
  const isB2B = posDetails?.business_type === "B2B";
  const isB2C = posDetails?.business_type === "B2C";
  const isCombined = posDetails?.business_type === "B2B & B2C";
  const print_receipt_on_order_complete =
    posDetails?.print_receipt_on_order_complete;
  const currencySymbol = posDetails?.currency_symbol;
  // Check if delivery is required - handle both 1/0 and true/false values
  const deliveryRequiredValue = posDetails?.custom_delivery_required;
  const isDeliveryRequired = deliveryRequiredValue === 1 ||
                             deliveryRequiredValue === true ||
                             deliveryRequiredValue === "1";
  const isItemTaxTemplateMode = posDetails?.custom_allow_item_tax_template === 1 ||
                                posDetails?.custom_allow_item_tax_template === true ||
                                posDetails?.custom_allow_item_tax_template === "1";

  const itemTaxTemplateNames = cartItems
    .map((item) => (item as { item_tax_template?: string }).item_tax_template)
    .filter(Boolean) as string[];
  const { rates: itemTaxTemplateRates } = useItemTaxTemplateRates(itemTaxTemplateNames);
  const freeItemTaxAmount = useFreeItemTaxAmount(cartItems, isItemTaxTemplateMode);



  // Debug log
  useEffect(() => {
    if (posDetails) {
      console.log("POS Details - custom_delivery_required:", deliveryRequiredValue, "isDeliveryRequired:", isDeliveryRequired);
    }
  }, [posDetails, deliveryRequiredValue, isDeliveryRequired]);

  // Populate sharing data from external invoice data
  useEffect(() => {
    if (externalInvoiceData && sharingMode) {
      console.log('External invoice data:', externalInvoiceData);
      console.log('Customer address doc:', externalInvoiceData.customer_address_doc);

      // Try multiple sources for customer contact info
      const email = externalInvoiceData.customer_address_doc?.email_id ||
                   externalInvoiceData.customer_email ||
                   externalInvoiceData.email_id ||
                   "";

      const phone = externalInvoiceData.mobile_no ||
                   externalInvoiceData.customer_address_doc?.mobile_no ||
                   externalInvoiceData.customer_address_doc?.phone ||
                   externalInvoiceData.customer_phone ||
                   "";

      const name = externalInvoiceData.customer_name ||
                  externalInvoiceData.customer ||
                  "";

      // If email or phone is missing, try to fetch customer details
      if ((!email || !phone) && externalInvoiceData.customer) {
        fetchCustomerDetails(externalInvoiceData.customer, email, phone, name);
      } else {
        setSharingData({
          email,
          phone,
          name,
        });

        console.log('Updated sharing data:', { email, phone, name });
      }
    }
  }, [externalInvoiceData, sharingMode]);

  // Function to fetch customer details if not available in invoice data
  const fetchCustomerDetails = async (customerId: string, existingEmail: string, existingPhone: string, existingName: string) => {
    try {
      console.log('Fetching customer details for:', customerId);
      const response = await fetch(`/api/method/klik_pos.api.customer.get_customer_info?customer_name=${customerId}`);
      const data = await response.json();

      if (data.message) {
        const customerData = data.message;
        console.log('Customer details fetched:', customerData);

        setSharingData({
          email: existingEmail || customerData.email_id || "",
          phone: existingPhone || customerData.mobile_no || "",
          name: existingName || customerData.customer_name || customerData.name || "",
        });

        console.log('Updated sharing data with customer details:', {
          email: existingEmail || customerData.email_id || "",
          phone: existingPhone || customerData.mobile_no || "",
          name: existingName || customerData.customer_name || customerData.name || "",
        });
      } else {
        // Fallback to existing data if fetch fails
        setSharingData({
          email: existingEmail,
          phone: existingPhone,
          name: existingName,
        });
      }
    } catch (error) {
      console.error('Error fetching customer details:', error);
      // Fallback to existing data if fetch fails
      setSharingData({
        email: existingEmail,
        phone: existingPhone,
        name: existingName,
      });
    }
  };

  // Load WhatsApp templates when sharing mode changes to WhatsApp
  useEffect(() => {
    const loadWhatsAppTemplates = async () => {
      if (sharingMode === 'whatsapp' && whatsappTemplates.length === 0) {
        setIsLoadingTemplates(true);
        try {
          const [templates, defaultTemplateName] = await Promise.all([
            fetchWhatsAppTemplates(),
            getDefaultWhatsAppTemplate()
          ]);

          setWhatsappTemplates(templates);

          // Set default template if available
          if (defaultTemplateName) {
            const defaultTemplate = templates.find(t => t.name === defaultTemplateName);
            if (defaultTemplate) {
              setSelectedTemplate(defaultTemplate);
              setCustomMessage(defaultTemplate.template);
            }
          } else {
            // Use default message template if no template is set
            setCustomMessage(getDefaultMessageTemplate());
          }
        } catch (error) {
          console.error('Error loading WhatsApp templates:', error);
          setCustomMessage(getDefaultMessageTemplate());
        } finally {
          setIsLoadingTemplates(false);
        }
      }
    };

    loadWhatsAppTemplates();
  }, [sharingMode, whatsappTemplates.length]);

  // Load Email templates when sharing mode changes to email
  useEffect(() => {
    const loadEmailTemplates = async () => {
      if (sharingMode === 'email' && emailTemplates.length === 0) {
        setIsLoadingEmailTemplates(true);
        try {
          const [templates, defaultTemplateName] = await Promise.all([
            fetchEmailTemplates(),
            getDefaultEmailTemplate()
          ]);

          setEmailTemplates(templates);

          // Set default template if available
          if (defaultTemplateName) {
            const defaultTemplate = templates.find(t => t.name === defaultTemplateName);
            if (defaultTemplate) {
              setSelectedEmailTemplate(defaultTemplate);
              setEmailMessage(defaultTemplate.response_html || defaultTemplate.response);
            }
          } else {
            // Use default message template if no template is set
            setEmailMessage(getDefaultEmailMessageTemplate());
          }
        } catch (error) {
          console.error('Error loading Email templates:', error);
          setEmailMessage(getDefaultEmailMessageTemplate());
        } finally {
          setIsLoadingEmailTemplates(false);
        }
      }
    };

    loadEmailTemplates();
  }, [sharingMode, emailTemplates.length]);

  // Helper function to get processed WhatsApp message
  const getProcessedMessage = () => {
    const parameters: Record<string, string> = {
      customer_name: sharingData.name || 'there',
      invoice_total: formatCurrency(calculations.grandTotal),
      invoice_number: invoiceData?.name || '',
      company_name: 'KLiK PoS',
      date: new Date().toLocaleDateString(),
    };

    return processTemplate(customMessage, parameters);
  };

  // Helper function to get processed email message
  const getProcessedEmailMessage = () => {
    const parameters: Record<string, string | null> = {
      customer_name: sharingData.name || 'Customer',
      customer: sharingData.name || 'Customer',
      first_name: sharingData.name?.split(' ')[0] || '',
      last_name: sharingData.name?.split(' ').slice(1).join(' ') || '',
      address: typeof selectedCustomer?.address === 'string' ? selectedCustomer.address : JSON.stringify(selectedCustomer?.address || {}),
      customer_address: typeof selectedCustomer?.address === 'string' ? selectedCustomer.address : JSON.stringify(selectedCustomer?.address || {}),
      delivery_note: invoiceData?.name || '',
      grand_total: formatCurrency(calculations.grandTotal),
      departure_time: new Date().toLocaleTimeString(),
      estimated_arrival: new Date(Date.now() + 30 * 60000).toLocaleTimeString(), // 30 minutes from now
      driver_name: 'Delivery Driver',
      cell_number: '+1234567890',
      vehicle: 'Delivery Vehicle',
      invoice_total: formatCurrency(calculations.grandTotal),
      invoice_number: invoiceData?.name || '',
      company_name: 'KLiK PoS',
      date: new Date().toLocaleDateString(),
    };

    return processEmailTemplate(emailMessage, parameters);
  };

  // Handle template selection
  const handleTemplateChange = (templateName: string) => {
    const template = whatsappTemplates.find(t => t.name === templateName);
    if (template) {
      setSelectedTemplate(template);
      setCustomMessage(template.template);
    }
  };

  // Handle email template selection
  const handleEmailTemplateChange = (templateName: string) => {
    const template = emailTemplates.find(t => t.name === templateName);
    if (template) {
      setSelectedEmailTemplate(template);
      setEmailMessage(template.response_html || template.response);
    }
  };

  // Calculate totals with memoization for performance
  const calculations = useMemo(() => {
    // Use discounted price if available, otherwise use original price (additional charges handled separately)
    const subtotal = cartItems.reduce(
      (sum, item) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const itemPrice = (item as any).discountedPrice || item.price;
        return sum + itemPrice * item.quantity;
      },
      0
    );
    const couponDiscount = appliedCoupons.reduce(
      (sum, coupon) => sum + coupon.value,
      0
    );
    const taxableAmount = Math.max(0, subtotal - couponDiscount);

    // Total additional amount = general + sum of per-item additional amounts (shown in payment dialog)
    const itemAdditionalTotal = cartItems.reduce(
      (sum, item) => sum + ((item as { additional_amount?: number }).additional_amount || 0),
      0
    );
    const totalAdditionalAmount = (generalAdditionalAmount || 0) + itemAdditionalTotal;

    if (isItemTaxTemplateMode) {
      // Tax from item tax template per item (exclusive); free items contribute 0 to this (rate is 0)
      let taxAmount = 0;
      cartItems.forEach((item) => {
        const itemPrice = (item as { discountedPrice?: number }).discountedPrice || item.price;
        const itemTotal = itemPrice * item.quantity;
        const template = (item as { item_tax_template?: string }).item_tax_template;
        const rate = template ? (itemTaxTemplateRates[template] ?? 0) : 0;
        taxAmount += (itemTotal * rate) / 100;
      });
      taxAmount = parseFloat(taxAmount.toFixed(3));
      // Include tax on free items (backend adds same as Actual rows; user pays this)
      const totalTaxAmount = taxAmount + (freeItemTaxAmount || 0) + (deliveryChargeTaxAmount || 0);
      const deliveryCharge = deliveryChargeAmount || 0;
      const grandTotal =
        taxableAmount + totalTaxAmount + totalAdditionalAmount + roundOffAmount + deliveryCharge;
      return {
        subtotal,
        couponDiscount,
        taxableAmount,
        taxAmount: totalTaxAmount,
        grandTotal,
        generalAdditionalAmount: generalAdditionalAmount || 0,
        totalAdditionalAmount,
        selectedTax: null,
        isInclusive: false,
      };
    }

    const selectedTax = salesTaxCharges.find(
      (tax) => tax.id === selectedSalesTaxCharges
    );
    const taxRate = selectedTax?.rate || 0;
    const isInclusive = selectedTax?.is_inclusive || false;

    let taxAmount: number;
    let grandTotal: number;

    if (isInclusive) {
      // For inclusive tax: tax is already included in the taxable amount
      taxAmount = (taxableAmount * taxRate) / (100 + taxRate);
      taxAmount = parseFloat(taxAmount.toFixed(3));
      grandTotal = taxableAmount;
    } else {
      // For exclusive tax: tax is added to the taxable amount
      taxAmount = (taxableAmount * taxRate) / 100;
      taxAmount = parseFloat(taxAmount.toFixed(3)); // Ensure 3 decimal places (e.g. BHD)
      grandTotal = taxableAmount + taxAmount;
    }

    const deliveryCharge = deliveryChargeAmount || 0;
    const deliveryChargeTax = deliveryChargeTaxAmount || 0;

    return {
      subtotal,
      couponDiscount,
      taxableAmount,
      taxAmount,
      grandTotal: grandTotal + totalAdditionalAmount + roundOffAmount + deliveryCharge + deliveryChargeTax,
      generalAdditionalAmount: generalAdditionalAmount || 0,
      totalAdditionalAmount,
      selectedTax,
      isInclusive,
    };
  }, [
    cartItems,
    appliedCoupons,
    selectedSalesTaxCharges,
    salesTaxCharges,
    roundOffAmount,
    isItemTaxTemplateMode,
    itemTaxTemplateRates,
    generalAdditionalAmount,
    freeItemTaxAmount,
    deliveryChargeTaxAmount,
    deliveryChargeAmount,
  ]);

  // Fetch loyalty redemption preview so amount_to_pay = grandTotal - loyalty_amount
  useEffect(() => {
    if (!isOpen || !selectedCustomer?.id || !redeemLoyaltyPoints || redeemLoyaltyPoints <= 0) {
      setLoyaltyPreview(null);
      return;
    }
    const grandTotal = calculations.grandTotal;
    let cancelled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          customer_id: selectedCustomer!.id,
          points_to_redeem: String(redeemLoyaltyPoints),
          grand_total: String(grandTotal),
        });
        const res = await fetch(`/api/method/klik_pos.api.customer.get_loyalty_redemption_preview?${params}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.message?.success && data?.message?.loyalty_amount != null) {
          setLoyaltyPreview({
            loyalty_amount: data.message.loyalty_amount,
            amount_to_pay: data.message.amount_to_pay ?? grandTotal - data.message.loyalty_amount,
          });
        } else {
          setLoyaltyPreview(null);
        }
      } catch {
        if (!cancelled) setLoyaltyPreview(null);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [isOpen, selectedCustomer?.id, redeemLoyaltyPoints, calculations.grandTotal]);

  // Amount the customer actually pays (after loyalty redemption discount)
  const effectiveGrandTotal = (redeemLoyaltyPoints && loyaltyPreview?.amount_to_pay != null)
    ? loyaltyPreview.amount_to_pay
    : calculations.grandTotal;

  // Calculate total paid amount from all payment methods (for both B2C and B2B)
  const totalPaidAmount = calculateTotalPayments(Object.values(paymentAmounts));
  const outstandingAmount = calculateRemainingAmount(effectiveGrandTotal, Object.values(paymentAmounts));

  useEffect(() => {
    if (isOpen && defaultTax && !selectedSalesTaxCharges) {
      setSelectedSalesTaxCharges(defaultTax);
    }
  }, [isOpen, defaultTax, selectedSalesTaxCharges]);

  useEffect(() => {
  if (!isOpen || modes.length === 0 || isCompanyDelivery) return;
 
  const defaultMode = modes.find((mode) => mode.default === 1);
  if (!defaultMode) return;
 
  // Check current payment state
  const hasAnyPayment = Object.keys(paymentAmounts).length > 0;
  const hasOnlyDefaultPayment = 
    hasAnyPayment && 
    Object.keys(paymentAmounts).length === 1 && 
    paymentAmounts[defaultMode.mode_of_payment];
 
  // Auto-fill ONLY if:
  // 1. No payments yet (first load), OR
  // 2. Only default method is populated (likely auto-filled, not manually edited)
  if (!hasAnyPayment || hasOnlyDefaultPayment) {
    const newAmount = parseFloat(effectiveGrandTotal.toFixed(3));
    setPaymentAmounts({ [defaultMode.mode_of_payment]: newAmount });
    setLastModifiedMethodId(defaultMode.mode_of_payment);
  }
}, [isOpen, modes, effectiveGrandTotal, isB2B, isB2C, isCompanyDelivery]);


  // useEffect(() => {
  //   if (isOpen && modes.length > 0 && !isCompanyDelivery) {
  //     const defaultMode = modes.find((mode) => mode.default === 1);
  //     if (defaultMode && Object.keys(paymentAmounts).length === 0) {
  //       const defaultAmount = parseFloat(effectiveGrandTotal.toFixed(3));
  //       setLastModifiedMethodId(defaultMode.mode_of_payment); // Track the auto-filled method
  //       setPaymentAmounts({ [defaultMode.mode_of_payment]: defaultAmount });
  //     }
  //   }
  // }, [isOpen, modes, effectiveGrandTotal, isB2B, isB2C, isCompanyDelivery]);

  useEffect(() => {

    if (modes.length > 0 && Object.keys(paymentAmounts).length > 0) {
      const defaultMode = modes.find((mode) => mode.default === 1);
      if (defaultMode) {
        // Calculate total of all payment methods
        const totalPayments = Object.values(paymentAmounts).reduce((sum, amount) => sum + (amount || 0), 0);
        const excess = totalPayments - effectiveGrandTotal;

        // Find the payment method with the highest amount
        const paymentEntries = Object.entries(paymentAmounts);
        const highestAmountMethod = paymentEntries.reduce((max, current) =>
          (current[1] || 0) > (max[1] || 0) ? current : max
        );
        const [highestMethodId, highestAmount] = highestAmountMethod;



        if (highestAmount > 0 && excess > 0) {
          // Subtract excess from the method with highest amount
          const newAmount = Math.max(0, highestAmount - excess);
          setPaymentAmounts((prev) => ({
            ...prev,
            [highestMethodId]: newAmount,
          }));
        }
      }
    }
  }, [effectiveGrandTotal, modes, isB2C, isB2B, isCombined, paymentAmounts]);

  // Auto-print when invoice is submitted and auto-print is enabled
  useEffect(() => {
    if (invoiceSubmitted && invoiceData && print_receipt_on_order_complete) {
      setIsAutoPrinting(true);
      // Small delay to ensure the preview is rendered
      setTimeout(() => {
        handlePrintInvoice(invoiceData);
        setIsAutoPrinting(false);
      }, 500);
    }
  }, [invoiceSubmitted, invoiceData, print_receipt_on_order_complete]);

  // Determine if roundoff should be enabled
  const isRoundOffEnabled = () => {
    // Check if writeoff is allowed in POS profile
    if (!posDetails?.custom_allow_write_off) {
      return false;
    }

    // Check if there are any cash payment methods with amounts
    const cashMethods = modes.filter(mode => mode.type === "Cash");
    const cashMethodsWithAmount = cashMethods.filter(mode =>
      (paymentAmounts[mode.mode_of_payment] || 0) > 0
    );

    // Must have cash methods with amounts
    return cashMethodsWithAmount.length > 0;
  };

  const roundOffEnabled = isRoundOffEnabled();

  // Clear roundoff when it becomes disabled
  useEffect(() => {
    if (!roundOffEnabled && roundOffAmount !== 0) {
      setRoundOffAmount(0);
      setRoundOffInput("0.00");
    }
  }, [roundOffEnabled, roundOffAmount]);

  // Keep an estimated tax amount for the Delivery Charge in sync with the current fee
  useEffect(() => {
    const amount = typeof deliveryChargeAmount === "number" ? deliveryChargeAmount : 0;
    if (!amount || amount <= 0) {
      setDeliveryChargeTaxAmount(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          amount: String(amount),
        });
        const res = await fetch(
          `/api/method/klik_pos.api.delivery_charges.get_delivery_charge_tax_amount?${params.toString()}`,
          { method: "GET", headers: { "Content-Type": "application/json" }, credentials: "include" }
        );
        const data = await res.json();
        if (cancelled) return;

        if (data?.message?.success && typeof data.message.tax === "number") {
          setDeliveryChargeTaxAmount(data.message.tax);
        } else {
          setDeliveryChargeTaxAmount(null);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to fetch delivery charge tax amount:", err);
        setDeliveryChargeTaxAmount(null);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [deliveryChargeAmount]);

  // When delivery personnel is selected (paid now) and delivery charges change the grand total,
  // keep the POS payment in sync by auto-filling the default payment method with the latest
  // effective grand total. This avoids having to click the payment method button again.
  useEffect(() => {
    if (!isOpen || isCompanyDelivery) return;
    if (!selectedDeliveryPersonnel) return;
    if (modes.length === 0) return;

    const defaultMode = modes.find((mode) => mode.default === 1) || modes[0];
    if (!defaultMode) return;

    const amount = parseFloat(effectiveGrandTotal.toFixed(3));
    setPaymentAmounts({ [defaultMode.mode_of_payment]: amount });
  }, [
    isOpen,
    isCompanyDelivery,
    selectedDeliveryPersonnel,
    modes,
    effectiveGrandTotal,
  ]);

  // When a delivery personnel is selected (paid now), auto-fill payment with full amount
  // including delivery charges, but only if there is no existing non-zero payment.
  useEffect(() => {
    if (!selectedDeliveryPersonnel || isCompanyDelivery) return;
    if (!isOpen || modes.length === 0) return;

    const hasAnyPayment = Object.values(paymentAmounts).some((amt) => (amt || 0) > 0);
    if (hasAnyPayment) return;

    const defaultMode = modes.find((mode) => mode.default === 1) || modes[0];
    if (!defaultMode) return;

    const amount = parseFloat(effectiveGrandTotal.toFixed(3));
    setPaymentAmounts({ [defaultMode.mode_of_payment]: amount });
  }, [
    selectedDeliveryPersonnel,
    isCompanyDelivery,
    isOpen,
    modes,
    paymentAmounts,
    effectiveGrandTotal,
  ]);

  if (!isOpen) return null;
  if (isLoading || posLoading) return <div className="p-6">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">Error: {error}</div>;

  // Sort modes to put default payment method first
  const sortedModes = [...modes].sort((a, b) => {
    // Default payment method (default === 1) should come first
    if (a.default === 1 && b.default !== 1) return -1;
    if (a.default !== 1 && b.default === 1) return 1;
    return 0; // Keep original order for non-default methods
  });

  // Include insurance mode of payment in the list when insurance is selected but not in POS modes
  const insuranceModeId = selectedHealthInsurance?.mode_of_payment || null;
  const hasInsuranceModeInModes = insuranceModeId && modes.some((m) => m.mode_of_payment === insuranceModeId);
  const paymentMethods: PaymentMethod[] = [
    ...sortedModes.map((mode) => {
      const { icon, color } = getIconAndColor(mode.type || "Default");
      return {
        id: mode.mode_of_payment,
        name: mode.mode_of_payment,
        icon,
        color,
        enabled: true,
        amount: paymentAmounts[mode.mode_of_payment] || 0,
      };
    }),
    ...(selectedHealthInsurance && insuranceModeId && !hasInsuranceModeInModes
      ? [
          {
            id: insuranceModeId,
            name: insuranceModeId,
            icon: getIconAndColor("Default").icon,
            color: "bg-teal-600",
            enabled: true,
            amount: paymentAmounts[insuranceModeId] || 0,
          } as PaymentMethod,
        ]
      : []),
  ];

  const getRoundTargetMethodId = (): string | null => {
    // If there's an active method and it exists in payment amounts, use it
    if (activeMethodId && activeMethodId in paymentAmounts) {
      return activeMethodId;
    }

    // Collect non-zero methods
    const nonZero = Object.entries(paymentAmounts).filter(([, amt]) => (amt || 0) > 0).map(([id]) => id);

    if (nonZero.length === 1) {
      return nonZero[0] ?? null;
    }

    // Prefer a non-default method that has a value
    const defaultId = modes.find((m) => m.default === 1)?.mode_of_payment || null;

    const nonDefaultWithValue = nonZero.find((id) => id !== defaultId);
    if (nonDefaultWithValue) {
      return nonDefaultWithValue;
    }

    // Fallback to default method
    return defaultId;
  };

  const handlePaymentAmountChange = (methodId: string, amount: string) => {
    if (invoiceSubmitted || isProcessingPayment) return;

    const numericAmount = roundCurrency(parseFloat(amount) || 0);

    setLastModifiedMethodId(methodId); // Track which method was just modified
    setPaymentAmounts((prev) => {
      const newAmounts = {
        ...prev,
        [methodId]: numericAmount,
      };

      return newAmounts;
    });
  };

  // Auto-fill payment method with grand total and clear others
  const handleAutoFillPayment = (methodId: string) => {
    if (invoiceSubmitted || isProcessingPayment) return;

    const grandTotal = effectiveGrandTotal;
    const newPaymentAmounts: PaymentAmount = {};

    // Set all payment methods to 0 first
    paymentMethods.forEach(method => {
      newPaymentAmounts[method.id] = 0;
    });

    // Set the selected method to grand total
    newPaymentAmounts[methodId] = grandTotal;


    setLastModifiedMethodId(methodId); // Track which method was just modified
    setPaymentAmounts(newPaymentAmounts);
    setActiveMethodId(methodId);
  };

  // Handle manual amount adjustment
  const handleManualAmountChange = (methodId: string, amount: string) => {
    if (invoiceSubmitted || isProcessingPayment) return;

    const numericAmount = roundCurrency(parseFloat(amount) || 0);
    // const grandTotal = effectiveGrandTotal;


    // Update the payment amount and let the adjustment useEffect handle the logic
    setLastModifiedMethodId(methodId);
    setPaymentAmounts((prev) => ({
      ...prev,
      [methodId]: numericAmount,
    }));
  };
  const handleRoundOff = () => {
    if (invoiceSubmitted || isProcessingPayment) return;

    // Check if writeoff is allowed in POS profile
    if (!posDetails?.custom_allow_write_off) {
      toast.error("Writeoff not allowed.\n Ask your administrator to enable it in POS profile.");
      return;
    }

    // Check if there are any cash payment methods with amounts
    const cashMethods = modes.filter(mode => mode.type === "Cash");
    const cashMethodsWithAmount = cashMethods.filter(mode =>
      (paymentAmounts[mode.mode_of_payment] || 0) > 0
    );

    if (cashMethodsWithAmount.length === 0) {
      toast.error("Writeoff is only allowed for cash payment methods");
      return;
    }

    // Check if cash has any amount
    const totalCashAmount = cashMethodsWithAmount.reduce((sum, mode) =>
      sum + (paymentAmounts[mode.mode_of_payment] || 0), 0
    );

    if (totalCashAmount === 0) {
      toast.error("Cash payment method must have an amount to apply writeoff");
      return;
    }

    const totalBeforeRoundOff = calculations.isInclusive
      ? calculations.taxableAmount
      : calculations.taxableAmount + calculations.taxAmount;

    // Get write_off_limit from POS profile (default to 1.0 if not set)
    const writeOffLimit = posDetails?.write_off_limit || 1.0;

    // New roundoff logic based on write_off_limit
    let rounded, difference;

    if (writeOffLimit <= 1) {
      // For write_off_limit <= 1, round down to nearest whole number (remove decimals)
      // Maximum roundoff is 0.99
      rounded = Math.floor(totalBeforeRoundOff);
      difference = rounded - totalBeforeRoundOff; // This will be negative (roundoff amount)
    } else {
      // For write_off_limit > 1, round down to nearest multiple of write_off_limit
      // Maximum roundoff is write_off_limit - 0.01
      rounded = Math.floor(totalBeforeRoundOff / writeOffLimit) * writeOffLimit;
      difference = rounded - totalBeforeRoundOff; // This will be negative (roundoff amount)
    }

    setRoundOffAmount(difference);
    setRoundOffInput(difference.toFixed(3));

    // Different behavior based on business type:
    // B2B: Don't auto-fill payment amounts (let user manually enter)
    // B2C & B2B & B2C: Auto-fill payment amounts (push checkout total to payment method)
    if (isB2B && !isB2C) {
      // Pure B2B: Don't auto-fill payment amounts
      // Just set the roundoff amount, don't modify payment amounts
    } else {
      // B2C or B2B & B2C: Auto-fill payment amounts

      // Adjust the currently active or most relevant payment method to reflect the rounded total
      const targetId = getRoundTargetMethodId();

      // Always ensure we have a valid target method
      let finalTargetId = targetId;

      if (!finalTargetId && paymentMethods.length > 0) {
        // Use first available method as fallback
        const firstMethod = paymentMethods[0];
        if (firstMethod) {
          finalTargetId = firstMethod.id;
        }
      }

      // Additional fallback: use default mode from modes if paymentMethods array is empty or unresolved
      if (!finalTargetId) {
        const fallbackDefaultFromModes = modes.find((m) => m.default === 1)?.mode_of_payment
          || modes[0]?.mode_of_payment;
        if (fallbackDefaultFromModes) {
          finalTargetId = fallbackDefaultFromModes;
        }
      }

      if (finalTargetId) {
        // For roundoff, we want to set the target method to the rounded total
        // and clear other methods to avoid confusion
        const newPaymentAmounts: PaymentAmount = {};

        // Set the target method to the rounded amount
        newPaymentAmounts[finalTargetId] = rounded;

        setPaymentAmounts(newPaymentAmounts);
      } else {
        console.error('No payment methods available for roundoff!');
      }
    }
  };

  const handleSalesTaxChange = (value: string) => {
    if (invoiceSubmitted || isProcessingPayment) return;
    setSelectedSalesTaxCharges(value);
  };

  const handleRoundOffChange = (value: string) => {
    // Prevent manual input if roundoff is not enabled
    if (!roundOffEnabled) {
      return;
    }

    // Ensure the value always starts with - for manual entry
    let processedValue = value;

    // If user enters a positive number, make it negative
    if (value && !value.startsWith('-') && !isNaN(parseFloat(value))) {
      processedValue = '-' + value;
    }

    const parsed = parseFloat(processedValue);
    if (!isNaN(parsed)) {
      // Validate against write-off limit
      const writeOffLimit = posDetails?.write_off_limit || 1.0;
      const maxAllowedRoundoff = writeOffLimit <= 1 ? 0.99 : writeOffLimit - 0.01;

      // Check if the absolute value exceeds the limit
      if (Math.abs(parsed) > maxAllowedRoundoff) {
        toast.error(`Roundoff amount cannot exceed ${maxAllowedRoundoff.toFixed(3)}. Write-off limit is ${writeOffLimit}.`);
        return;
      }

      setRoundOffInput(processedValue);
      setRoundOffAmount(parsed);

      // Recompute new grand total after roundoff change
      const newGrandTotal =
        (calculations.isInclusive
          ? calculations.taxableAmount
          : calculations.taxableAmount + calculations.taxAmount) + parsed;

      const targetId = getRoundTargetMethodId();
      if (targetId) {
        const sumOthers = Object.entries(paymentAmounts)
          .filter(([id]) => id !== targetId)
          .reduce((sum, [, amt]) => sum + (amt || 0), 0);
        const newTargetAmount = Math.max(0, parseFloat((newGrandTotal - sumOthers).toFixed(3)));
        setPaymentAmounts((prev) => ({
          ...prev,
          [targetId]: newTargetAmount,
        }));
      }
    }
  };

  const processPayment = async (
    deliveryPersonnel: string | null = null,
    deliveryVia: string | null = null,
    referenceNo: string | null = null
  ) => {
    if (!selectedCustomer || !selectedCustomer.name) {
      toast.error("Kindly select a customer");
      return;
    }
    // For B2B, we don't need payment validation
    // For B2C, validate payment completion
    if (isB2C) {
      const activePaymentMethods = Object.entries(paymentAmounts)
        .filter(([, amount]) => amount > 0)
        .map(([method, amount]) => ({ method, amount }));

      if (activePaymentMethods.length === 0) {
        toast.error("Please enter payment amounts");
        return;
      }

      if (outstandingAmount > 0) {
        toast.error("Please complete the payment before proceeding");
        return;
      }
    }

    // For B2B, no payment validation required - can be partial or zero payment
    setIsProcessingPayment(true);

    // Calculate net amount to send to backend (amount paid minus change for B2C)
    const netAmountToSend = isB2B ? totalPaidAmount : effectiveGrandTotal;

    // For B2C, adjust payment method amounts to reflect net payment (after change)
    const adjustedPaymentMethods = isB2B
      ? Object.entries(paymentAmounts).filter(([, amount]) => amount > 0)
      : (() => {
          const validPayments = Object.entries(paymentAmounts).filter(([, amount]) => amount > 0);

          if (validPayments.length === 0) return [];

          // Calculate total of all payment methods
          const totalPaymentAmount = validPayments.reduce((sum, [, amount]) => sum + amount, 0);

          // If total exceeds grand total, adjust the last payment method
          if (totalPaymentAmount > effectiveGrandTotal) {
            const excess = totalPaymentAmount - effectiveGrandTotal;
            const lastPaymentIndex = validPayments.length - 1;
            const lastPayment = validPayments[lastPaymentIndex];
            if (!lastPayment) return;
            const lastAmount = lastPayment[1];

            // Reduce the last payment method by the excess amount
            const adjustedLastAmount = parseFloat(Math.max(0, lastAmount - excess).toFixed(3));

            return validPayments.map(([method, amount], index) => {
              if (index === lastPaymentIndex) {
                return [method, adjustedLastAmount];
              }
              return [method, amount];
            });
          }

          return validPayments;
        })();

    const getLineKey = (i: CartItem) => (i as CartItem & { cartLineId?: string }).cartLineId || i.id;
    const paymentData = {
      items: cartItems.map(item => {
        const lineKey = getLineKey(item);
        const discount = itemDiscounts[lineKey] || itemDiscounts[item.id];
        const medOrder = (discount as { medicationOrder?: string } | undefined)?.medicationOrder
          ?? (item as { medicationOrder?: string }).medicationOrder;
        return {
          ...item,
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
          price: (item as any).discountedPrice || item.price, // Use discounted price
          batchNumber: (item as { batch_no?: string }).batch_no ?? discount?.batchNumber ?? null,
          serialNumber: (item as { serial_no?: string }).serial_no ?? discount?.serialNumber ?? null,
          uom: item.uom || 'Nos', // Include selected UOM
          discountPercentage: discount?.discountPercentage || 0,
          discountAmount: discount?.discountAmount || 0,
          dosage: discount?.dosage ?? item.dosage ?? null,
          prescriptionDosage: discount?.prescriptionDosage ?? item.prescriptionDosage ?? null,
          medicationOrder: medOrder || undefined,
          item_tax_template: (item as { item_tax_template?: string }).item_tax_template || null,
          additional_amount: (item as { additional_amount?: number }).additional_amount || 0,
        };
      }),
      customer: selectedCustomer,
      paymentMethods: (adjustedPaymentMethods ?? []).map(([method, amount]) => ({ method, amount: parseFloat((Number(amount) || 0).toFixed(3)) })),
      subtotal: calculations.subtotal,
      SalesTaxCharges: isItemTaxTemplateMode ? null : selectedSalesTaxCharges,
      taxAmount: calculations.taxAmount,
      taxType: calculations.isInclusive ? "inclusive" : "exclusive",
      couponDiscount: calculations.couponDiscount,
      roundOffAmount,
      grandTotal: calculations.grandTotal,
      amountPaid: netAmountToSend, // Send net amount (effective total for B2C after loyalty, total paid for B2B)
      outstandingAmount: outstandingAmount,
      appliedCoupons,
      generalAdditionalAmount: generalAdditionalAmount || 0,
      // Remark from Additional Amounts modal -> Sales Invoice.custom_remark
      additionalRemark: additionalRemark && additionalRemark.trim().length ? additionalRemark.trim() : null,
      businessType: posDetails?.business_type,
      deliveryPersonnel: deliveryPersonnel || null,
      deliveryVia: deliveryVia || null,
      referenceNo: referenceNo || null,
      deliveryDistanceKm: deliveryDistanceKm ?? null,
      deliveryChargeAmount: deliveryChargeAmount ?? 0,
      // Patient Medication Orders - from itemDiscounts or cart item; backend also extracts from items
      medicationOrder: (() => {
        const orders = new Set<string>();
        cartItems.forEach((item) => {
          const lineKey = getLineKey(item);
          const discount = itemDiscounts[lineKey] || itemDiscounts[item.id];
          const orderName = (discount as { medicationOrder?: string } | undefined)?.medicationOrder
            ?? (item as { medicationOrder?: string }).medicationOrder;
          if (orderName) orders.add(orderName);
          const orderNames = (item as { medicationOrders?: string[] }).medicationOrders;
          if (Array.isArray(orderNames)) {
            orderNames.forEach((o) => o && orders.add(o));
          }
        });
        return Array.from(orders);
      })(),
      redeemLoyaltyPoints: !!(redeemLoyaltyPoints && redeemLoyaltyPoints > 0),
      loyaltyPoints: redeemLoyaltyPoints ?? 0,
      healthInsurance: selectedHealthInsurance?.name || null,
      insuranceAmount: selectedHealthInsurance
        ? roundCurrency((effectiveGrandTotal * (Number(selectedHealthInsurance.insurance_coverage_) || 0)) / 100)
        : 0,
      insuranceIsCredit: selectedHealthInsurance?.isCredit !== false,
    };

    try {
      const response = await createSalesInvoice(paymentData);
      setInvoiceSubmitted(true);
      setSubmittedInvoice(response);
      setInvoiceData(response.invoice);

      const successMessage = isB2B
        ? "Invoice submitted successfully!"
        : "Payment completed successfully!";
      toast.success(successMessage);

      // Delete original draft invoice if it exists (from Edit → Go to Cart workflow)
      const originalDraftInvoiceId = getOriginalDraftInvoiceId();
      // console.log("Checking for original draft invoice to delete:", originalDraftInvoiceId);

      if (originalDraftInvoiceId) {
        try {
          // const deleteResult = await deleteDraftInvoice(originalDraftInvoiceId);
        } catch (deleteError) {
          console.error("Failed to delete original draft invoice:", deleteError);
          // Don't show error to user as the main invoice was created successfully
        }
      } else {
        console.log();
      }

      // Clear draft invoice cache since payment is completed
      clearDraftInvoiceCache();

      // Don't clear cart immediately - let modal stay open for invoice preview
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      const defaultMessage = isB2B
        ? "Failed to submit invoice"
        : "Failed to process payment";

      const errorMessage = extractErrorFromException(err, defaultMessage);
      toast.error(errorMessage);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleCompletePayment = async () => {
    console.log(
      "handleCompletePayment called - selectedDeliveryPersonnel:",
      selectedDeliveryPersonnel
    );

    // Always process payment directly; delivery personnel is optional
    await processPayment(selectedDeliveryPersonnel, selectedDeliveryVia, selectedReferenceNo);
  };

  const handleDeliveryPersonnelSelect = (selection: {
    personnelName: string | null;
    deliveryVia: string | null;
    referenceNo?: string | null;
    distanceKm?: number | null;
    deliveryFee?: number | null;
  }) => {
    // Called from the footer-triggered modal only; just store selection
    setSelectedDeliveryPersonnel(selection.personnelName || null);
    setSelectedDeliveryVia(selection.deliveryVia);
    setSelectedReferenceNo(selection.referenceNo ?? null);
    setDeliveryDistanceKm(
      typeof selection.distanceKm === "number" && !Number.isNaN(selection.distanceKm)
        ? selection.distanceKm
        : null
    );
    setDeliveryChargeAmount(
      typeof selection.deliveryFee === "number" && !Number.isNaN(selection.deliveryFee)
        ? selection.deliveryFee
        : null
    );
    const hasPersonnel = !!selection.personnelName;
    const hasChannel = !!selection.deliveryVia;

    // Company delivery: channel selected, no personnel -> pay later, clear all payments
    if (hasChannel && !hasPersonnel) {
      setIsCompanyDelivery(true);
      // Try to use Delivery Channel's mode_of_payment; fall back to default POS mode if missing.
      const channel = deliveryChannels.find((c) => c.name === selection.deliveryVia);
      let mop = channel?.mode_of_payment || null;
      if (!mop && modes.length > 0) {
        const defaultMode = modes.find((mode) => mode.default === 1) || modes[0];
        mop = defaultMode?.mode_of_payment || null;
      }

      if (mop) {
        // Create one payment row with amount 0.0 to satisfy ERPNext POS validation
        setPaymentAmounts({ [mop]: 0 });
      } else {
        // As a safety net, keep payments empty if we truly have no Mode of Payment to use
        setPaymentAmounts({});
      }
      setRoundOffAmount(0);
      setRoundOffInput("0.000");
    } else {
      // Normal (immediate) delivery: allow payments
      setIsCompanyDelivery(false);

      // If we now have a delivery personnel (paid now) and no existing payments,
      // auto-fill default payment method with the full effective grand total (incl. delivery).
      if (hasPersonnel && isOpen && modes.length > 0) {
        const hasAnyPayment = Object.values(paymentAmounts).some((amt) => (amt || 0) > 0);
        if (!hasAnyPayment) {
          const defaultMode = modes.find((mode) => mode.default === 1) || modes[0];
          if (defaultMode) {
            const amount = parseFloat(effectiveGrandTotal.toFixed(3));
            setPaymentAmounts({ [defaultMode.mode_of_payment]: amount });
          }
        }
      }
    }

    setShowDeliveryPersonnelModal(false);
  };

  // Get display name for selected delivery personnel
  const getSelectedDeliveryPersonnelName = () => {
    if (!selectedDeliveryPersonnel) return null;
    const person = deliveryPersonnelList.find((p) => p.name === selectedDeliveryPersonnel);
    return person?.delivery_personnel || selectedDeliveryPersonnel;
  };

  const clearDeliverySelection = () => {
    if (invoiceSubmitted || isProcessingPayment) return;
    setSelectedDeliveryPersonnel(null);
    setSelectedDeliveryVia(null);
    setSelectedReferenceNo(null);
    setDeliveryDistanceKm(null);
    setDeliveryChargeAmount(null);
    setDeliveryChargeTaxAmount(null);
  };

  const handleInsuranceSelect = (insurance: HealthInsuranceOption | null) => {
    setSelectedHealthInsurance(insurance);
    setShowInsuranceModal(false);
    if (!insurance || invoiceSubmitted || isProcessingPayment) return;
    const coverage = Number(insurance.insurance_coverage_) || 0;
    const insuranceMode = insurance.mode_of_payment || null;
    if (!insuranceMode || coverage <= 0) return;
    const grandTotal = effectiveGrandTotal;
    const insuranceAmount = roundCurrency((grandTotal * coverage) / 100);
    const patientAmount = roundCurrency(grandTotal - insuranceAmount);
    const cashMode = modes.find((m) => (m.type || "").toLowerCase() === "cash")?.mode_of_payment
      || modes[0]?.mode_of_payment;
    if (!cashMode) return;
    const isCredit = insurance.isCredit !== false;
    if (isCredit) {
      // Patient pays their portion now; insurance pays later (invoice partially paid)
      setPaymentAmounts({
        [insuranceMode]: 0,
        [cashMode]: patientAmount,
      });
    } else {
      setPaymentAmounts({
        [insuranceMode]: insuranceAmount,
        [cashMode]: patientAmount,
      });
    }
  };

  const clearInsuranceSelection = () => {
    if (invoiceSubmitted || isProcessingPayment) return;
    setSelectedHealthInsurance(null);
  };

  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewInvoice = (invoice: any) => {
    navigate(`/invoice/${invoice.name}`);
  };

  const handleHoldOrder = async () => {
    if (!selectedCustomer) {
      toast.error("Kindly select a customer");
      return;
    }

    setIsHoldingOrder(true);

    const getLineKeyHold = (i: CartItem) => (i as CartItem & { cartLineId?: string }).cartLineId || i.id;
    const orderData = {
      items: cartItems.map(item => {
        const lineKey = getLineKeyHold(item);
        const discount = itemDiscounts[lineKey] || itemDiscounts[item.id];
        return {
          ...item,
          batchNumber: (item as { batch_no?: string }).batch_no ?? discount?.batchNumber ?? null,
          serialNumber: (item as { serial_no?: string }).serial_no ?? discount?.serialNumber ?? null,
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
          const orderName = (discount as { medicationOrder?: string } | undefined)?.medicationOrder;
          if (orderName) orders.add(orderName);
        });
        return Array.from(orders);
      })(),
      subtotal: calculations.subtotal,
      SalesTaxCharges: isItemTaxTemplateMode ? null : selectedSalesTaxCharges,
      taxAmount: calculations.taxAmount,
      taxType: calculations.isInclusive ? "inclusive" : "exclusive",
      couponDiscount: calculations.couponDiscount,
      roundOffAmount,
      grandTotal: calculations.grandTotal,
      generalAdditionalAmount: generalAdditionalAmount || 0,
      // Remark from Additional Amounts modal -> Sales Invoice.custom_remark
      additionalRemark: additionalRemark && additionalRemark.trim().length ? additionalRemark.trim() : null,
      appliedCoupons,
      status: "held",
      businessType: posDetails?.business_type,
      deliveryPersonnel: selectedDeliveryPersonnel || null,
      deliveryVia: selectedDeliveryVia || null,
      referenceNo: selectedReferenceNo || null,
      deliveryDistanceKm: deliveryDistanceKm ?? null,
      deliveryChargeAmount: deliveryChargeAmount ?? 0,
    };

    try {
      await createDraftSalesInvoice(orderData);
      // toast.success("Order held successfully!");

      // Clear draft invoice cache since order is held
      clearDraftInvoiceCache();

      onHoldOrder(orderData);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      const errorMessage = extractErrorFromException(err, "Failed to hold order");
      toast.error(errorMessage);
    } finally {
      setIsHoldingOrder(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `${currencySymbol} ${amount.toLocaleString(undefined, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    })}`;
  };

  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Get the appropriate button text and validation
  const getActionButtonText = () => {
    if (isProcessingPayment) {
      return isB2B ? "Submitting Invoice..." : "Processing Payment...";
    }

    if (isB2B) {
      if (totalPaidAmount === 0) {
        return "Submit Invoice (Pay Later)";
      } else if (outstandingAmount > 0) {
        return "Submit Invoice (Partial Payment)";
      } else {
        return "Submit Invoice (Paid)";
      }
    }

    return "Complete Payment";
  };

  const isActionButtonDisabled = () => {
    if (invoiceSubmitted || isProcessingPayment) return true;
    // For B2C, check if payment is complete
    if (isB2C) return outstandingAmount > 0;
    // For B2B, no payment validation needed
    return false;
  };

  if (isMobile) {
    // Mobile view remains mostly the same, just update the button text and validation
    return (
      <div
        className={
          isFullPage
            ? "h-full bg-white dark:bg-gray-900 overflow-y-auto custom-scrollbar"
            : "fixed inset-0 bg-white dark:bg-gray-900 z-50 overflow-y-auto custom-scrollbar"
        }
      >
        <div className="min-h-screen">
          {!isFullPage && (
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
                {invoiceSubmitted
                  ? "Invoice Complete"
                  : isB2B
                  ? "Submit Invoice"
                  : "Payment"}
              </h1>
              {/* ... rest of mobile header remains the same ... */}
            </div>
          )}

          <div className="p-4 space-y-6">
            {invoiceSubmitted ? (
              <div className="space-y-4">
                {/* Action Buttons for Mobile */}
                <div className="flex items-center justify-center space-x-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <div className="text-green-600 dark:text-green-400 text-center">
                    <p className="font-semibold">
                      {isB2B
                        ? "Invoice Submitted Successfully!"
                        : "Payment Completed Successfully!"}
                    </p>
                    <p className="text-sm opacity-75">
                      Total: {formatCurrency(calculations.grandTotal)}
                    </p>
                  </div>
                </div>

                {/* Action Buttons Row */}
                <div className="flex flex-wrap gap-2 justify-center">
                  {isAutoPrinting && (
                    <div className="flex items-center space-x-2 text-blue-600 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">Printing...</span>
                    </div>
                  )}

                  <button
                    className="flex items-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    title="Print"
                    onClick={() => {
                      handlePrintInvoice(invoiceData);
                    }}
                  >
                    <Printer size={18} />
                    <span>Print</span>
                  </button>

                  <button
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/30 transition-colors"
                    title="Email"
                    onClick={() => {
                      const subject = encodeURIComponent("Your Invoice");
                      const body = encodeURIComponent(
                        `Dear ${
                          selectedCustomer?.name
                        },\n\nHere is your invoice total: ${formatCurrency(
                          effectiveGrandTotal
                        )}\n\nThank you.`
                      );
                      window.open(
                        `mailto:${selectedCustomer?.email}?subject=${subject}&body=${body}`
                      );
                    }}
                  >
                    <MailPlus size={18} />
                    <span>Email</span>
                  </button>

                  <button
                    className="flex items-center space-x-2 px-4 py-2 bg-green-100 dark:bg-green-900/20 text-beveren-600 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/30 transition-colors"
                    title="WhatsApp"
                    onClick={() => {
                      const msg = encodeURIComponent(
                        `Here is your invoice total: ${formatCurrency(
                          effectiveGrandTotal
                        )}`
                      );
                      window.open(
                        `https://wa.me/${selectedCustomer?.phone}?text=${msg}`,
                        "_blank"
                      );
                    }}
                  >
                    <MessageCirclePlus size={18} />
                    <span>WhatsApp</span>
                  </button>

                  <button
                    className="flex items-center space-x-2 px-4 py-2 bg-purple-100 dark:bg-teal-900/20 text-teal-500 dark:text-teal-400 rounded-lg hover:bg-teal-200 dark:hover:bg-purple-900/30 transition-colors"
                    title="Text Message"
                    onClick={() =>
                      window.open(`tel:${selectedCustomer?.phone}`)
                    }
                  >
                    <MessageSquarePlus size={18} />
                    <span>SMS</span>
                  </button>

                  <button
                    className="flex items-center space-x-2 px-4 py-2 bg-purple-100 dark:bg-purple-900/20 text-p-600 dark:text-purple-400 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/30 transition-colors"
                    title="View Full Invoice"
                    onClick={() => handleViewInvoice(invoiceData)}
                  >
                    <Eye size={18} />
                    <span>View</span>
                  </button>
                </div>

                {/* Invoice Preview for Mobile */}
                {invoiceData && (
                  <div className="bg-white rounded-lg border border-gray-200 p-4 dark:bg-white dark:border-gray-200">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
                      Invoice Preview:
                    </h4>
                    <div className="border border-gray-300 rounded p-3 bg-gray-50 max-h-64 overflow-y-auto dark:border-gray-300 dark:bg-gray-50">
                      <DisplayPrintPreview invoice={invoiceData} />
                    </div>
                  </div>
                )}

                {/* New Order Button */}
                <div className="pt-4">
                  <button
                    onClick={() => {
                      // Simply close the modal - no navigation needed
                      onClose(true);
                    }}
                    className="w-full py-3 bg-beveren-600 text-white rounded-lg font-medium hover:bg-beveren-700 transition-colors"
                  >
                    Start New Order
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Payment Methods - Only show for B2C */}
                {(isB2C || isB2B) && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Payment Methods
                      </h2>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!selectedHealthInsurance}
                          onChange={() => {
                            if (selectedHealthInsurance) clearInsuranceSelection();
                            else setShowInsuranceModal(true);
                          }}
                          disabled={invoiceSubmitted || isProcessingPayment}
                          className="rounded border-gray-300 dark:border-gray-600 text-beveren-600 focus:ring-beveren-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">Insurance</span>
                      </label>
                    </div>
                    <div className="flex space-x-3 overflow-x-auto pb-2">
                      {paymentMethods.map((method) => (
                        <div
                          key={method.id}
                          className={`${
                            paymentMethods.length <= 3
                              ? "flex-1 min-w-0"
                              : "min-w-[280px] max-w-[280px] flex-shrink-0"
                          } border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-beveren-300 transition-colors ${
                            invoiceSubmitted || isProcessingPayment
                              ? "bg-gray-50 dark:bg-gray-800"
                              : ""
                          }`}
                        >
                          <div className="flex items-center space-x-3 mb-3">
                            <div
                              className={`w-10 h-10 rounded-lg ${method.color} text-white flex items-center justify-center`}
                            >
                              <div className="scale-75">{method.icon}</div>
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-gray-900 dark:text-white text-sm">
                                {method.name}
                              </p>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Amount
                            </label>
                            <input
                              type="number"
                              value={method.amount.toFixed(3) || "0.000"}
                              onChange={(e) =>
                                handlePaymentAmountChange(
                                  method.id,
                                  e.target.value
                                )
                              }
                              placeholder="0.00"
                              disabled={invoiceSubmitted || isProcessingPayment}
                              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${
                                invoiceSubmitted || isProcessingPayment
                                  ? "cursor-not-allowed opacity-50"
                                  : ""
                              }`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tax Type Indicator */}

                {/* Round Off */}
                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Round Off
                      </label>
                      <div className="flex space-x-2">
                        <input
                          type="number"
                          value={roundOffInput}
                          onChange={(e) => handleRoundOffChange(e.target.value)}
                          disabled={invoiceSubmitted || isProcessingPayment || !roundOffEnabled}
                          placeholder="-0.00"
                          className={`flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${
                            invoiceSubmitted || isProcessingPayment || !roundOffEnabled
                              ? "cursor-not-allowed opacity-50"
                              : ""
                          }`}
                        />
                        <button
                          onClick={handleRoundOff}
                          disabled={invoiceSubmitted || isProcessingPayment || !roundOffEnabled}
                          className={`px-3 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors ${
                            invoiceSubmitted || isProcessingPayment || !roundOffEnabled
                              ? "cursor-not-allowed opacity-50"
                              : ""
                          }`}
                          title="Auto Round"
                        >
                          <Calculator size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Totals */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">
                      Subtotal
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {formatCurrency(calculations.subtotal)}
                    </span>
                  </div>
                  {calculations.couponDiscount > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span>Discount</span>
                      <span>
                        -{formatCurrency(calculations.couponDiscount)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">
                      VAT ({calculations.selectedTax?.rate}%{" "}
                      {calculations.isInclusive ? "Incl." : "Excl."})
                    </span>
                    <span
                      className={`font-medium ${
                        calculations.isInclusive
                          ? "text-beveren-600 dark:text-beveren-400"
                          : "text-gray-900 dark:text-white"
                      }`}
                    >
                      {calculations.isInclusive
                        ? `(${formatCurrency(calculations.taxAmount)})`
                        : formatCurrency(calculations.taxAmount)}
                    </span>
                  </div>
                  {calculations.totalAdditionalAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">
                        Additional Amount
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {formatCurrency(calculations.totalAdditionalAmount)}
                      </span>
                    </div>
                  )}
                  {roundOffAmount !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">
                        Round Off
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {formatCurrency(roundOffAmount)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
                    <div className="flex justify-between">
                      <span className="text-lg font-bold text-gray-900 dark:text-white">
                        Grand Total
                      </span>
                      <span className="text-lg font-bold text-gray-900 dark:text-white">
                        {formatCurrency(calculations.grandTotal)}
                      </span>
                    </div>
                  </div>
                  {loyaltyPreview && loyaltyPreview.loyalty_amount > 0 && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Loyalty redemption</span>
                        <span className="text-amber-600 dark:text-amber-400">-{formatCurrency(loyaltyPreview.loyalty_amount)}</span>
                      </div>
                      <div className="flex justify-between font-medium text-gray-900 dark:text-white">
                        <span>Amount to pay</span>
                        <span>{formatCurrency(effectiveGrandTotal)}</span>
                      </div>
                    </>
                  )}

                  {(isB2C || isB2B) && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          Total Paid
                        </span>
                        <span className="font-medium text-beveren-600 dark:text-blue-400">
                          {formatCurrency(totalPaidAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          Outstanding
                        </span>
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {formatCurrency(outstandingAmount)}
                        </span>
                      </div>
                      {totalPaidAmount > effectiveGrandTotal && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">
                            Change
                          </span>
                          <span className="font-medium text-beveren-600 dark:text-beveren-400">
                            {formatCurrency(
                              subtractCurrency(totalPaidAmount, effectiveGrandTotal)
                            )}
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  {isB2B && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">
                        Outstanding Amount
                      </span>
                      <span className="font-medium text-orange-600 dark:text-orange-400">
                        {formatCurrency(effectiveGrandTotal)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-6">
                  <button
                    onClick={handleCompletePayment}
                    disabled={isActionButtonDisabled()}
                    className={`w-full py-4 rounded-lg font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2 ${
                      isB2B
                        ? "bg-blue-600 hover:bg-blue-700 text-white"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {isProcessingPayment ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        <span>{getActionButtonText()}</span>
                      </>
                    ) : (
                      <span>{getActionButtonText()}</span>
                    )}
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={handleHoldOrder}
                      disabled={
                        invoiceSubmitted ||
                        isProcessingPayment ||
                        isHoldingOrder
                      }
                      className={`py-3 px-4 border border-orange-500 text-orange-600 dark:text-orange-400 rounded-lg font-medium hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors flex items-center justify-center space-x-2 ${
                        invoiceSubmitted ||
                        isProcessingPayment ||
                        isHoldingOrder
                          ? "cursor-not-allowed opacity-50"
                          : ""
                      }`}
                    >
                      {isHoldingOrder ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          <span>Holding...</span>
                        </>
                      ) : (
                        <span>Hold Order</span>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Desktop view with similar modifications
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {isB2B ? "Invoice Submission" : "Payment Processing"}
          </h2>

          {invoiceSubmitted ? (
            <div className="flex items-center space-x-3">
              {isAutoPrinting && (
                <div className="flex items-center space-x-2 text-blue-600">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">Printing...</span>
                </div>
              )}
              <button
                className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                title="Print"
                onClick={() => {
                  handlePrintInvoice(invoiceData);
                  navigate("/");
                }}
              >
                <Printer size={20} />
              </button>

              <button
                className={`p-2 rounded-lg ${
                  sharingMode === "email"
                    ? "bg-blue-100 text-blue-700"
                    : "text-blue-600 hover:bg-blue-100"
                } dark:text-blue-400 dark:hover:bg-blue-900`}
                title="Email"
                onClick={() =>
                  setSharingMode(sharingMode === "email" ? null : "email")
                }
              >
                <MailPlus size={20} />
              </button>

              <button
                className={`p-2 rounded-lg ${
                  sharingMode === "whatsapp"
                    ? "bg-blue-100 text-green-700"
                    : "text-green-600 hover:bg-green-100"
                } dark:text-green-400 dark:hover:bg-green-900`}
                title="WhatsApp"
                onClick={() =>
                  setSharingMode(sharingMode === "whatsapp" ? null : "whatsapp")
                }
                style={{ display: posDetails?.custom_enable_whatsapp ? 'block' : 'none' }}
              >
                <MessageCirclePlus size={20} />
              </button>

              <button
                className={`p-2 rounded-lg ${
                  sharingMode === "sms"
                    ? "bg-blue-100 text-blue-700"
                    : "text-blue-600 hover:bg-blue-100"
                } dark:text-blue-400 dark:hover:bg-blue-900`}
                title="SMS"
                onClick={() =>
                  setSharingMode(sharingMode === "sms" ? null : "sms")
                }
                style={{ display: posDetails?.custom_enable_sms ? 'block' : 'none' }}
              >
                <MessageSquarePlus size={20} />
              </button>

              <button
                className="p-2 text-purple-600 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900 rounded-lg"
                title="View Full"
                onClick={() => handleViewInvoice(invoiceData)}
              >
                <Eye size={20} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onClose(invoiceSubmitted)}
              disabled={isProcessingPayment || isHoldingOrder}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={24} />
            </button>
          )}
        </div>

        {/* Main Content */}
        <div className="flex flex-1 min-h-0">
          {/* Left Section */}
          <div className="w-2/3 p-6 overflow-y-auto custom-scrollbar space-y-6">
            {(invoiceSubmitted && sharingMode) ||
            (externalInvoiceData && sharingMode) ? (
              // Sharing Interface
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white capitalize">
                    Share via {sharingMode}
                  </h3>
                  <button
                    onClick={() => setSharingMode(null)}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <X size={20} />
                  </button>
                </div>

                {sharingMode === "email" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Customer Name
                      </label>
                      <input
                        type="text"
                        value={sharingData.name}
                        onChange={(e) =>
                          setSharingData((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        placeholder="Customer name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={sharingData.email}
                        onChange={(e) =>
                          setSharingData((prev) => ({
                            ...prev,
                            email: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        placeholder="customer@email.com"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          Email Message Preview
                        </label>
                        <button
                          type="button"
                          onClick={() => setIsEditingEmail(!isEditingEmail)}
                          className="text-sm text-beveren-600 hover:text-beveren-700 dark:text-beveren-400 dark:hover:text-beveren-300 font-medium"
                        >
                          {isEditingEmail ? (
      <Check className="w-4 h-4" />
    ) : (
      <Pencil className="w-4 h-4" />
    )}
                        </button>
                      </div>

                      {isEditingEmail && (
                        <div className="space-y-3 mb-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Email Template
                            </label>
                            {isLoadingEmailTemplates ? (
                              <div className="flex items-center justify-center p-4">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                <span className="text-sm text-gray-500">Loading templates...</span>
                              </div>
                            ) : (
                              <select
                                value={selectedEmailTemplate?.name || ""}
                                onChange={(e) => handleEmailTemplateChange(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              >
                                <option value="">Select a template (optional)</option>
                                {emailTemplates.map((template) => {
                                  const isDefault = posDetails?.custom_email_template === template.name;
                                  return (
                                    <option key={template.name} value={template.name}>
                                      {template.name}{isDefault ? ' [Default]' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                            )}
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Custom Message
                            </label>
                            <textarea
                              value={emailMessage}
                              onChange={(e) => setEmailMessage(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              rows={6}
                              placeholder="Enter your email message..."
                            />
                          </div>
                        </div>
                      )}

                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                          Subject: Your Invoice from KLiK PoS
                        </p>
                        <div className="text-sm text-gray-900 dark:text-white">
                          <div
                            className="whitespace-pre-wrap"
                            dangerouslySetInnerHTML={{ __html: getProcessedEmailMessage() }}
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={async () => {
                        setIsSendingEmail(true);
                        try {
                          await sendEmails({
                            email: sharingData.email,
                            customer_name: sharingData.name,
                            invoice_data: invoiceData?.name || '',
                            message: getProcessedEmailMessage(),
                          });
                          toast.success("Email sent successfully!");
                          setSharingMode(null);
                          //eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } catch (error: any) {
                          const userFriendlyError = getUserFriendlyError(error.message, 'email');
                          toast.error(userFriendlyError);
                        } finally {
                          setIsSendingEmail(false);
                        }
                      }}
                      disabled={!sharingData.email || isSendingEmail}
                      className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSendingEmail ? "Sending..." : "Send Email"}
                    </button>
                  </div>
                )}

                {sharingMode === "whatsapp" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Customer Name
                      </label>
                      <input
                        type="text"
                        value={sharingData.name}
                        onChange={(e) =>
                          setSharingData((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        placeholder="Customer name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={sharingData.phone}
                        onChange={(e) =>
                          setSharingData((prev) => ({
                            ...prev,
                            phone: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        placeholder="+254700000000"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          WhatsApp Message Preview
                        </label>
                        <button
                          type="button"
                          onClick={() => setIsEditingWhatsapp(!isEditingWhatsapp)}
                          className="text-sm text-beveren-600 hover:text-beveren-700 dark:text-beveren-400 dark:hover:text-beveren-300 font-medium"
                        >
                          {isEditingWhatsapp ? (
      <Check className="w-4 h-4" />
    ) : (
      <Pencil className="w-4 h-4" />
    )}
                        </button>
                      </div>

                      {isEditingWhatsapp && (
                        <div className="space-y-3 mb-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              WhatsApp Template
                            </label>
                            {isLoadingTemplates ? (
                              <div className="flex items-center justify-center p-4">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                <span className="text-sm text-gray-500">Loading templates...</span>
                              </div>
                            ) : (
                              <select
                                value={selectedTemplate?.name || ""}
                                onChange={(e) => handleTemplateChange(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              >
                                <option value="">Select a template (optional)</option>
                                {whatsappTemplates.map((template) => {
                                  const isDefault = posDetails?.custom_whatsap_template === template.name;
                                  return (
                                    <option key={template.name} value={template.name}>
                                      {template.template_name} - {template.category} ({template.status}){isDefault ? ' [Default]' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                            )}
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Custom Message
                            </label>
                            <textarea
                              value={customMessage}
                              onChange={(e) => setCustomMessage(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              rows={4}
                              placeholder="Enter your WhatsApp message..."
                            />
                          </div>
                        </div>
                      )}

                      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                        <div className="text-sm text-gray-900 dark:text-white">
                          <div className="whitespace-pre-wrap">
                            {getProcessedMessage()}
                          </div>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        setIsSendingWhatsapp(true);
                        try {
                          await sendWhatsAppMessage({
                            mobile_no: sharingData.phone,
                            customer_name: sharingData.name,
                            invoice_data: invoiceData?.name || '',
                            message: getProcessedMessage(),
                          });
                          toast.success("Whatsap message sent successfully!");
                          setSharingMode(null);
                          //eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } catch (error: any) {
                          const userFriendlyError = getUserFriendlyError(error.message, 'whatsapp');
                          toast.error(userFriendlyError);
                        } finally {
                          setIsSendingWhatsapp(false);
                        }
                      }}
                      disabled={!sharingData.phone || isSendingWhatsapp}
                      className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSendingWhatsapp
                        ? "Sending..."
                        : "Send Whatsap Message"}
                    </button>
                  </div>
                )}

                {sharingMode === "sms" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Customer Name
                      </label>
                      <input
                        type="text"
                        value={sharingData.name}
                        onChange={(e) =>
                          setSharingData((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        placeholder="Customer name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={sharingData.phone}
                        onChange={(e) =>
                          setSharingData((prev) => ({
                            ...prev,
                            phone: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        placeholder="+254700000000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        SMS Message Preview
                      </label>
                      <div className="bg-teal-50 dark:bg-teal-900/20 rounded-lg p-4 border border-teal-200 dark:border-teal-800">
                        <div className="text-sm text-gray-900 dark:text-white">
                          <p>Hi {sharingData.name || "Customer"}!</p>
                          <p className="mt-1">
                            Thank you for your purchase at KLiK PoS.
                          </p>
                          <p className="mt-1">
                            Invoice Total:{" "}
                            {formatCurrency(calculations.grandTotal)}
                          </p>
                          <p className="mt-1">Thank you!</p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await sendSMSMessage({
                            mobile_no: sharingData.phone,
                            customer_name: sharingData.name,
                            message: `Thank you for your purchase at KLiK PoS.\nInvoice Total: ${formatCurrency(calculations.grandTotal)}\nThank you!`
                          });
                          toast.success("SMS sent successfully!");
                          setSharingMode(null);
                          //eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } catch (error: any) {
                          const userFriendlyError = getUserFriendlyError(error.message, 'sms');
                          toast.error(userFriendlyError);
                        }
                      }}
                      disabled={!sharingData.phone}
                      className="w-full py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                      Send SMS
                    </button>
                  </div>
                )}
              </div>
            ) : (
              // Original payment content
              <div className="space-y-6">
                {/* Payment Methods */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Payment Methods
                    </h3>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!selectedHealthInsurance}
                        onChange={() => {
                          if (selectedHealthInsurance) clearInsuranceSelection();
                          else setShowInsuranceModal(true);
                        }}
                        disabled={invoiceSubmitted || isProcessingPayment}
                        className="rounded border-gray-300 dark:border-gray-600 text-beveren-600 focus:ring-beveren-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Insurance</span>
                    </label>
                  </div>
                  <div className="flex space-x-4 overflow-x-auto pb-2">
                    {paymentMethods.map((method) => (
                      <div
                        key={method.id}
                        className={`${
                          paymentMethods.length <= 3
                            ? "flex-1 min-w-0"
                            : "min-w-[300px] flex-shrink-0"
                        } border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-beveren-300 transition-colors ${
                          invoiceSubmitted || isProcessingPayment
                            ? "bg-gray-50 dark:bg-gray-800"
                            : ""
                        }`}
                      >
                        <div className="flex items-center space-x-3 mb-3">
                          <div
                            className={`w-8 h-6 rounded-md ${method.color} text-white flex items-center justify-center`}
                          >
                            <div className="scale-75">{method.icon}</div>
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 dark:text-white text-sm">
                              {method.name}
                            </p>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                              Amount
                            </label>
                            <div className="flex space-x-1">
                              <button
                                onClick={() => handleAutoFillPayment(method.id)}
                                disabled={invoiceSubmitted || isProcessingPayment}
                                className={`p-1 rounded text-xs ${
                                  invoiceSubmitted || isProcessingPayment
                                    ? "cursor-not-allowed opacity-50"
                                    : "hover:bg-beveren-100 text-beveren-600"
                                }`}
                                title="Auto-fill with grand total"
                              >
                                <CheckCircle size={16} />
                              </button>

                            </div>
                          </div>
                          <input
                            type="number"
                            step="0.01"
                              value={method.amount.toFixed(3)}
                            onChange={(e) => {
                              setActiveMethodId(method.id);
                              const inputValue = e.target.value;
                              const numValue =
                                inputValue === "" ? 0 : parseFloat(inputValue);
                              handleManualAmountChange(
                                method.id,
                                isNaN(numValue) ? "0" : numValue.toString()
                              );
                            }}
                            onBlur={(e) => {
                              setActiveMethodId(method.id);
                              const numValue = parseFloat(e.target.value);
                              if (!isNaN(numValue)) {
                                const formatted = parseFloat(
                                  numValue.toFixed(3)
                                );
                                handleManualAmountChange(method.id, formatted.toString());
                              }
                            }}
                            placeholder="0.00"
                            disabled={invoiceSubmitted || isProcessingPayment}
                            className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm ${
                              invoiceSubmitted || isProcessingPayment
                                ? "cursor-not-allowed opacity-50"
                                : ""
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tax Section - hidden when using item tax template mode */}
                {!isItemTaxTemplateMode && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Tax Configuration
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Sales & Tax Charges
                      </label>
                      <select
                        value={selectedSalesTaxCharges}
                        onChange={(e) => handleSalesTaxChange(e.target.value)}
                        disabled={invoiceSubmitted || isProcessingPayment}
                        className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${
                          invoiceSubmitted || isProcessingPayment
                            ? "cursor-not-allowed opacity-50"
                            : ""
                        }`}
                      >
                        {salesTaxCharges.map((tax) => (
                          <option key={tax.id} value={tax.id}>
                            {tax.name} ({tax.rate}%{" "}
                            {tax.is_inclusive ? "Incl." : "Excl."})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Tax Amount {calculations.isInclusive && "(Included)"}
                      </label>
                      <div
                        className={`px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg font-medium ${
                          calculations.isInclusive
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-gray-900 dark:text-white"
                        }`}
                      >
                        {calculations.isInclusive
                          ? `(${formatCurrency(calculations.taxAmount)})`
                          : formatCurrency(calculations.taxAmount)}
                      </div>
                    </div>
                  </div>
                </div>
                )}
                {isItemTaxTemplateMode && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    VAT (from Item Tax Templates)
                  </h3>
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg font-medium text-gray-900 dark:text-white">
                    {formatCurrency(calculations.taxAmount)}
                  </div>
                </div>
                )}

                {/* Totals Section */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    {isB2B ? "Invoice Summary" : "Payment Summary"}
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Round Off
                        </label>
                        <div className="flex space-x-2">
                          <input
                            type="number"
                            value={roundOffInput}
                            onChange={(e) =>
                              handleRoundOffChange(e.target.value)
                            }
                            disabled={invoiceSubmitted || isProcessingPayment || !roundOffEnabled}
                            placeholder="-0.00"
                            className={`flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${
                              invoiceSubmitted || isProcessingPayment
                                ? "cursor-not-allowed opacity-50"
                                : ""
                            }`}
                          />
                          <button
                            onClick={handleRoundOff}
                            disabled={invoiceSubmitted || isProcessingPayment || !roundOffEnabled}
                            className={`px-3 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors ${
                              invoiceSubmitted || isProcessingPayment || !roundOffEnabled
                                ? "cursor-not-allowed opacity-50"
                                : ""
                            }`}
                            title="Auto Round"
                          >
                            <Calculator size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-600 pt-3 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          Subtotal
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {formatCurrency(calculations.subtotal)}
                        </span>
                      </div>
                      {calculations.couponDiscount > 0 && (
                        <div className="flex justify-between text-green-600 dark:text-green-400">
                          <span>Coupon Discount</span>
                          <span>
                            -{formatCurrency(calculations.couponDiscount)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          VAT ({calculations.selectedTax?.rate}%{" "}
                          {calculations.isInclusive ? "Incl." : "Excl."})
                        </span>
                        <span
                          className={`font-medium ${
                            calculations.isInclusive
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-gray-900 dark:text-white"
                          }`}
                        >
                          {calculations.isInclusive
                            ? `(${formatCurrency(calculations.taxAmount)})`
                            : formatCurrency(calculations.taxAmount)}
                        </span>
                      </div>
{calculations.totalAdditionalAmount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-gray-400">
                                Additional Amount
                              </span>
                              <span className="font-medium text-gray-900 dark:text-white">
                                {formatCurrency(calculations.totalAdditionalAmount)}
                              </span>
                            </div>
                          )}
                      {roundOffAmount !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">
                            Round Off
                          </span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {formatCurrency(roundOffAmount)}
                          </span>
                        </div>
                      )}
                      <div className="border-t border-gray-200 dark:border-gray-600 pt-2">
                        <div className="flex justify-between">
                          <span className="text-xl font-bold text-gray-900 dark:text-white">
                            Grand Total
                          </span>
                          <span className="text-xl font-bold text-gray-900 dark:text-white">
                            {formatCurrency(calculations.grandTotal)}
                          </span>
                        </div>
                      </div>
                      {loyaltyPreview && loyaltyPreview.loyalty_amount > 0 && (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Loyalty redemption</span>
                            <span className="text-amber-600 dark:text-amber-400">-{formatCurrency(loyaltyPreview.loyalty_amount)}</span>
                          </div>
                          <div className="flex justify-between font-medium text-gray-900 dark:text-white">
                            <span>Amount to pay</span>
                            <span>{formatCurrency(effectiveGrandTotal)}</span>
                          </div>
                        </>
                      )}

                      {(isB2C || isB2B) && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Total Paid
                            </span>
                            <span className="font-medium text-blue-600 dark:text-blue-400">
                              {formatCurrency(totalPaidAmount)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Outstanding Amount
                            </span>
                            <span
                              className={`font-bold ${
                                outstandingAmount > 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-green-600 dark:text-green-400"
                              }`}
                            >
                              {formatCurrency(outstandingAmount)}
                            </span>
                          </div>
                          {totalPaidAmount > effectiveGrandTotal && (
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-gray-400">
                                Change
                              </span>
                              <span className="font-bold text-green-600 dark:text-green-400">
                                {formatCurrency(
                                  subtractCurrency(totalPaidAmount, effectiveGrandTotal)
                                )}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Section - Invoice Preview */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-600 flex-1 overflow-y-auto custom-scrollbar">
            {/* Show PrintPreview if invoice is submitted */}
            {invoiceSubmitted && invoiceData ? (
              <div className="mb-4">
                <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-center">
                  Print Format Preview:
                </h5>
                <div className="border border-gray-300 rounded p-2 bg-gray-50 dark:border-gray-300 dark:bg-gray-50">
                  <DisplayPrintPreview invoice={invoiceData} />
                </div>
              </div>
            ) : (
              // Regular invoice preview when not submitted
              <>
                <div className="text-center mb-4">
                  <h4 className="font-bold text-lg text-gray-900 dark:text-white">
                    KLiK PoS
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {isB2B ? "Sales Invoice" : "Sales Invoice"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    {currentDate}
                  </p>
                  {isB2B && (
                    <p className="text-xs text-orange-600 dark:text-orange-400 font-medium mt-1">
                      Payment Pending
                    </p>
                  )}
                </div>

                {selectedCustomer && (
                  <div className="mb-4 pb-2 border-b border-gray-200 dark:border-gray-600">
                    <p className="font-medium text-gray-900 dark:text-white">
                      {selectedCustomer.name}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {selectedCustomer.email}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {selectedCustomer.phone}
                    </p>
                  </div>
                )}

                <div className="space-y-2 mb-4">
                  {cartItems.length > 0 ? (
                    // Show cart items for payment
                    cartItems.map((item, index) => (
                      <div key={index} className="flex justify-between text-sm">
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 dark:text-white">
                              {item.name}
                            </p>
                            <p className="text-gray-600 dark:text-gray-400">
                              {item.quantity} x {formatCurrency(item.price)}
                            </p>
                          </div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {formatCurrency(item.quantity * item.price)}
                          </p>
                        </div>
                      ))
                  ) : (
                    // Show invoice details for sharing
                    <div className="space-y-4">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                          Invoice Details
                        </h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Invoice #:
                            </span>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {externalInvoiceData?.name ||
                                selectedCustomer?.name ||
                                "N/A"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Customer:
                            </span>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {externalInvoiceData?.customer ||
                                selectedCustomer?.name ||
                                "N/A"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Total:
                            </span>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {formatCurrency(
                                externalInvoiceData?.grand_total ||
                                  effectiveGrandTotal
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Invoice Preview */}
                      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                        <DisplayPrintPreview
                          invoice={
                            externalInvoiceData || submittedInvoice || {}
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 dark:border-gray-600 pt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">
                      Subtotal
                    </span>
                    <span className="text-gray-900 dark:text-white">
                      {formatCurrency(calculations.subtotal)}
                    </span>
                  </div>
                  {calculations.couponDiscount > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span>Discount</span>
                      <span>
                        -{formatCurrency(calculations.couponDiscount)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">
                      VAT ({calculations.selectedTax?.rate}%{" "}
                      {calculations.isInclusive ? "Incl." : "Excl."})
                    </span>
                    <span
                      className={`${
                        calculations.isInclusive
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-gray-900 dark:text-white"
                      }`}
                    >
                      {calculations.isInclusive
                        ? `(${formatCurrency(calculations.taxAmount)})`
                        : formatCurrency(calculations.taxAmount)}
                    </span>
                  </div>
                  {roundOffAmount !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">
                        Round Off
                      </span>
                      <span className="text-gray-900 dark:text-white">
                        {formatCurrency(roundOffAmount)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 dark:border-gray-600 pt-1">
                    <div className="flex justify-between font-bold">
                      <span className="text-gray-900 dark:text-white">
                        Total
                      </span>
                      <span className="text-gray-900 dark:text-white">
                        {formatCurrency(effectiveGrandTotal)}
                      </span>
                    </div>
                  </div>

                  {/* Payment Methods Used - Only show for B2C with actual amounts */}
                  {(isB2C || isB2B) &&
                    Object.entries(paymentAmounts).filter(
                      ([, amount]) => amount > 0
                    ).length > 0 && (
                      <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Payment Methods:
                        </p>
                        {Object.entries(paymentAmounts)
                          .filter(([, amount]) => amount > 0)
                          .map(([method, amount]) => (
                            <div
                              key={method}
                              className="flex justify-between text-xs"
                            >
                              <span className="text-gray-600 dark:text-gray-400">
                                {method}
                              </span>
                              <span className="text-gray-900 dark:text-white">
                                {formatCurrency(amount)}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}

                  {/* B2B Outstanding Amount Display */}
                  {isB2B && (
                    <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-orange-600 dark:text-orange-400 font-medium">
                          Outstanding Amount:
                        </span>
                        <span className="text-orange-600 dark:text-orange-400 font-bold">
                          {formatCurrency(effectiveGrandTotal)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Payment to be collected separately
                      </p>
                    </div>
                  )}

                  {/* Tax Type Note */}
                  {calculations.selectedTax && (
                    <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
                      <p
                        className={`text-xs ${
                          calculations.isInclusive
                            ? "text-blue-500 dark:text-blue-400"
                            : "text-orange-500 dark:text-orange-400"
                        }`}
                      >
                        VAT is{" "}
                        {calculations.isInclusive ? "inclusive" : "exclusive"}{" "}
                        of item prices
                      </p>
                    </div>
                  )}

                  {/* QR Code */}
                  {invoiceSubmitted &&
                    submittedInvoice?.invoice?.custom_invoice_qr_code && (
                      <div className="mt-4 text-center">
                        <img
                          src={submittedInvoice.invoice.custom_invoice_qr_code}
                          alt="Invoice QR Code"
                          className="mx-auto w-20 h-20 object-contain border border-gray-200 dark:border-gray-600 rounded-lg"
                        />
                      </div>
                    )}
                </div>

                <div className="text-center mt-4 pt-2 border-t border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Thank you for your business!
                  </p>
                  {isB2B && (
                    <p className="text-xs text-orange-500 dark:text-orange-400 mt-1">
                      Invoice will be sent for payment processing
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer - Action Buttons */}
        {invoiceSubmitted || externalInvoiceData ? (
          <div className="border-t border-gray-200 dark:border-gray-700 p-6 flex-shrink-0 bg-white dark:bg-gray-800">
            <div className="flex items-center justify-between">
              {/* Delivery Personnel Field - Far Left - Only show if delivery is required */}
              {isDeliveryRequired && (
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Delivery Personnel
                  </label>
                  <div className="flex items-center space-x-2 max-w-xs">
                    <button
                      type="button"
                      onClick={() => setShowDeliveryPersonnelModal(true)}
                      disabled={invoiceSubmitted || isProcessingPayment}
                      className={`flex-1 px-4 py-2 text-left border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-between ${
                        invoiceSubmitted || isProcessingPayment
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer"
                      }`}
                    >
                      <span className="truncate">
                        {getSelectedDeliveryPersonnelName() || (
                          <span className="text-gray-500 dark:text-gray-400">
                            Select Delivery Personnel
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        size={16}
                        className="text-gray-400 dark:text-gray-500 flex-shrink-0 ml-2"
                      />
                    </button>
                    {(selectedDeliveryPersonnel || deliveryChargeAmount) && (
                      <button
                        type="button"
                        onClick={clearDeliverySelection}
                        disabled={invoiceSubmitted || isProcessingPayment}
                        className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-400 hover:text-red-500 hover:border-red-400 dark:hover:text-red-400 dark:hover:border-red-400 transition-colors"
                        title="Clear delivery selection"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className={`flex justify-end space-x-4 ${isDeliveryRequired ? '' : 'w-full'}`}>
                {invoiceSubmitted && (
                  <button
                    onClick={() => onClose(true)}
                    className="bg-beveren-500 px-6 py-2 border border-gray-300 dark:border-gray-600 text-white dark:text-gray-300 rounded-lg font-medium hover:bg-green-700 dark:hover:bg-gray-800 transition-colors"
                  >
                    New Order
                  </button>
                )}
                {externalInvoiceData && (
                  <button
                    onClick={() => onClose()}
                    className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-200 dark:border-gray-700 p-6 flex-shrink-0 bg-white dark:bg-gray-800">
            <div className="flex items-center justify-between">
              {/* Delivery Personnel Field - Far Left - Only show if delivery is required */}
              {isDeliveryRequired && (
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Delivery Personnel
                  </label>
                  <div className="flex items-center space-x-2 max-w-xs">
                    <button
                      type="button"
                      onClick={() => setShowDeliveryPersonnelModal(true)}
                      disabled={invoiceSubmitted || isProcessingPayment}
                      className={`flex-1 px-4 py-2 text-left border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-between ${
                        invoiceSubmitted || isProcessingPayment
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer"
                      }`}
                    >
                      <span className="truncate">
                        {getSelectedDeliveryPersonnelName() || (
                          <span className="text-gray-500 dark:text-gray-400">
                            Select Delivery Personnel
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        size={16}
                        className="text-gray-400 dark:text-gray-500 flex-shrink-0 ml-2"
                      />
                    </button>
                    {(selectedDeliveryPersonnel || deliveryChargeAmount) && (
                      <button
                        type="button"
                        onClick={clearDeliverySelection}
                        disabled={invoiceSubmitted || isProcessingPayment}
                        className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-400 hover:text-red-500 hover:border-red-400 dark:hover:text-red-400 dark:hover:border-red-400 transition-colors"
                        title="Clear delivery selection"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className={`flex justify-end space-x-4 ${isDeliveryRequired ? '' : 'w-full'}`}>
                <button
                  onClick={handleHoldOrder}
                  disabled={
                    invoiceSubmitted || isProcessingPayment || isHoldingOrder
                  }
                  className={`px-6 py-2 border  border-gray-300 dark:border-gray-600 text-gray-700 rounded-lg font-medium hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors flex items-center space-x-2 ${
                    invoiceSubmitted || isProcessingPayment || isHoldingOrder
                      ? "cursor-not-allowed opacity-50"
                      : ""
                  }`}
                >
                  {isHoldingOrder ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Holding...</span>
                    </>
                  ) : (
                    <span>Hold Order</span>
                  )}
                </button>
                <button
                  onClick={handleCompletePayment}
                  disabled={isActionButtonDisabled()}
                  className={`px-8 py-2 rounded-lg font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center space-x-2 ${
                    isB2B
                      ? "bg-beveren-500 hover:bg-blue-700 text-white"
                      : "bg-beveren-600 hover:bg-beveren-700 text-white"
                  }`}
                >
                  {isProcessingPayment ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{getActionButtonText()}</span>
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      <span>{getActionButtonText()}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delivery Personnel Modal */}
      <DeliveryPersonnelModal
        isOpen={showDeliveryPersonnelModal}
        onClose={() => setShowDeliveryPersonnelModal(false)}
        onSelect={handleDeliveryPersonnelSelect}
        grandTotal={effectiveGrandTotal}
      />

      {/* Insurance (Health Insurance) Modal */}
      <InsuranceModal
        isOpen={showInsuranceModal}
        onClose={() => setShowInsuranceModal(false)}
        onSelect={handleInsuranceSelect}
        selectedInsurance={selectedHealthInsurance}
      />
    </div>
  );
}
