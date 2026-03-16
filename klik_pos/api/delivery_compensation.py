# Copyright (c) 2026, KLiK PoS and contributors
# For license information, please see license.txt

"""
Create Delivery Compensation records when a POS Sales Invoice with delivery personnel
is submitted. Tracks amount to be paid by the company to the delivery person.

- If distance was below the first threshold: no delivery charge on invoice; compensation
  amount = Standard Delivery Charges (from Delivery Charges setup).
- If delivery charges were added to the invoice: compensation amount = those delivery
  charges (amount on the invoice).
"""

import frappe
from frappe.utils import flt


def get_standard_delivery_charges():
	val = frappe.db.get_single_value("Delivery Charges", "standard_delivery_charges")
	
	return flt(val or 0)


def get_delivery_charge_item_code():
	"""Return the Item code used for delivery charge line items."""
	from klik_pos.api.delivery_charges import _ensure_delivery_charge_item
	return _ensure_delivery_charge_item()


def get_delivery_charge_amount_from_invoice(doc):
	"""Sum the amount of delivery charge item line(s) on the given Sales Invoice."""
	if not doc.get("items"):
		return 0.0
	try:
		item_code = get_delivery_charge_item_code()
	except Exception:
		return 0.0
	total = 0.0
	for row in doc.items:
		if getattr(row, "item_code", None) == item_code:
			total += flt(row.get("amount") or 0, 2)
	return total


def create_compensation_for_sales_invoice(doc, method=None):
	"""
	If the Sales Invoice has delivery personnel set, create a Delivery Compensation
	record for the amount the company will pay to the delivery person.

	- If the invoice has no delivery charge line (distance < first threshold): use
	  Standard Delivery Charges.
	- If the invoice has delivery charge line(s): use the total delivery charge amount.
	"""
	if not doc.get("custom_delivery_personnel"):
		return
	# Only for submitted POS invoices
	if doc.docstatus != 1:
		return
	if not getattr(doc, "is_pos", 0):
		return

	delivery_person = doc.custom_delivery_personnel
	posting_date = doc.posting_date or frappe.utils.getdate()
	sales_invoice = doc.name

	# When distance >= first threshold: delivery charge item is on the invoice; use that total.
	delivery_charge_on_invoice = get_delivery_charge_amount_from_invoice(doc)
	if delivery_charge_on_invoice > 0:
		amount = delivery_charge_on_invoice

	else:

		amount = get_standard_delivery_charges()
	if flt(amount, 2) <= 0:
		return

	# Create Delivery Compensation (amount field may be Int on DocType; use rounded value)
	comp = frappe.get_doc(
		{
			"doctype": "Delivery Compensation",
			"posting_date": posting_date,
			"delivery_person": delivery_person,
			"sales_invoice": sales_invoice,
			"amount": flt(amount, 2),
			"status": "Unpaid",
		}
	)
	comp.insert(ignore_permissions=True)
	comp.submit()
	
	return comp.name
