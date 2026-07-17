"""Controlled-drug (narcotic / psychotropic) register (BRD PHA-07).

Serene is a psychiatry hospital, so a large part of the formulary is controlled: benzodiazepines,
Z-drugs, stimulants (ADHD), opioids/addiction-treatment agents, and anything the formulary tags as
"controlled". When such a drug is dispensed at the POS, a ``Controlled Drug Register`` entry is
created capturing patient / UHID / prescriber / quantity / batch and the running stock balance.

Classification keys off ``Item.custom_drug_category`` (the formulary's own classification).
"""

import frappe
from frappe.utils import cint, flt, nowtime, today

# Substrings (lowercased) in Item.custom_drug_category that mark a drug as controlled.
_CONTROLLED_CATEGORY_KEYWORDS = (
	"controlled",
	"bzd",
	"benzodiazepin",
	"z-drug",
	"hypnotic",
	"opioid",
	"narcotic",
	"stimulant",
	"adhd",
	"addiction treatment",
	"barbiturate",
	"amphetamine",
)


def _category_is_controlled(category):
	if not category:
		return False
	low = str(category).lower()
	return any(kw in low for kw in _CONTROLLED_CATEGORY_KEYWORDS)


def is_controlled_item(item_code):
	"""True when the Item's drug category marks it as a controlled substance."""
	if not item_code:
		return False
	category = frappe.db.get_value("Item", item_code, "custom_drug_category")
	return _category_is_controlled(category)


def _stock_balance(item_code, warehouse):
	if not item_code or not warehouse:
		return None
	return flt(
		frappe.db.get_value(
			"Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty"
		)
		or 0
	)


def _resolve_prescriber(item, patient):
	"""Best-effort prescriber from the cart line / linked medication order."""
	for key in ("practitioner", "prescriber", "ordered_by", "doctor"):
		val = (item.get(key) or "").strip() if isinstance(item.get(key), str) else item.get(key)
		if val:
			return val
	entry_name = (
		item.get("medication_order_entry") or item.get("medicationOrderEntry") or ""
	).strip()
	if entry_name and frappe.db.exists("Inpatient Medication Order Entry", entry_name):
		order = frappe.db.get_value(
			"Inpatient Medication Order Entry", entry_name, "parent"
		)
		if order:
			return frappe.db.get_value("Patient Medication Order", order, "practitioner")
	return None


def record_controlled_dispense(invoice_doc, items):
	"""Create a Controlled Drug Register entry for each controlled drug on the invoice.

	Non-blocking: a failure here never rolls back the completed sale.
	"""
	try:
		if not frappe.db.exists("DocType", "Controlled Drug Register"):
			return
		items = items or []
		if not items:
			return

		from klik_pos.api.patient import resolve_patient_from_customer

		patient = resolve_patient_from_customer(getattr(invoice_doc, "customer", None))
		patient_name = (
			frappe.db.get_value("Patient", patient, "patient_name") if patient else None
		)
		warehouse = getattr(invoice_doc, "set_warehouse", None) or getattr(
			invoice_doc, "warehouse", None
		)
		pos_profile = getattr(invoice_doc, "pos_profile", None)

		# Prefer the actual per-line warehouse/qty from the submitted invoice items.
		invoice_lines = {}
		for row in invoice_doc.get("items") or []:
			invoice_lines.setdefault(row.item_code, []).append(row)

		for item in items:
			if not isinstance(item, dict):
				continue
			item_code = (item.get("id") or item.get("item_code") or "").strip()
			if not item_code or not is_controlled_item(item_code):
				continue

			line = None
			bucket = invoice_lines.get(item_code)
			if bucket:
				line = bucket[0]

			qty = flt(item.get("quantity") or item.get("qty") or (line.qty if line else 0))
			line_warehouse = (line.warehouse if line else None) or warehouse
			batch_no = (
				item.get("batch_no")
				or item.get("batchNo")
				or (getattr(line, "batch_no", None) if line else None)
			)
			uom = item.get("uom") or (getattr(line, "uom", None) if line else None)
			category = frappe.db.get_value("Item", item_code, "custom_drug_category")

			doc = frappe.get_doc(
				{
					"doctype": "Controlled Drug Register",
					"posting_date": getattr(invoice_doc, "posting_date", None) or today(),
					"posting_time": getattr(invoice_doc, "posting_time", None) or nowtime(),
					"sales_invoice": invoice_doc.name,
					"pos_profile": pos_profile,
					"warehouse": line_warehouse,
					"patient": patient,
					"patient_name": patient_name,
					"uhid": patient,
					"prescriber": _resolve_prescriber(item, patient),
					"medication_order": (
						item.get("medication_order")
						or item.get("medicationOrder")
						or ""
					),
					"drug": item_code,
					"drug_category": category,
					"batch_no": batch_no,
					"quantity": qty,
					"uom": uom,
					"balance_qty": _stock_balance(item_code, line_warehouse),
					"dispensed_by": frappe.session.user,
				}
			)
			doc.flags.ignore_permissions = True
			doc.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "record_controlled_dispense failed")


@frappe.whitelist()
def get_controlled_flags(item_codes=None):
	"""Return {item_code: is_controlled} so the UI can badge controlled drugs."""
	import json

	if isinstance(item_codes, str):
		try:
			item_codes = json.loads(item_codes)
		except Exception:
			item_codes = [item_codes]
	item_codes = item_codes or []
	return {code: is_controlled_item(code) for code in item_codes}
