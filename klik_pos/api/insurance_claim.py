# Copyright (c) 2026, KLiK PoS and contributors
# Creates Insurance Claim from POS Sales Invoice after submit (Health Insurance + approved amount).

import frappe
from frappe import _
from frappe.utils import flt, today


def create_insurance_claim_for_pos(doc, health_insurance_name, insurance_amount):
	"""
	Create an Insurance Claim (Healthcare) for a submitted POS Sales Invoice
	when payment was split with Health Insurance. Sets total_approved to insurance_amount.

	- doc: submitted Sales Invoice document
	- health_insurance_name: name of Health Insurance selected in POS
	- insurance_amount: amount allocated to insurance (approved amount for the claim)
	"""
	if not frappe.db.exists("DocType", "Insurance Claim"):
		frappe.log_error("Insurance Claim DocType not found (Healthcare app).", "POS Insurance Claim")
		return
	if not health_insurance_name or flt(insurance_amount) <= 0:
		return

	# Resolve patient: from Sales Invoice or from Customer link
	patient = getattr(doc, "patient", None)
	if not patient and doc.customer:
		patient = frappe.db.get_value("Customer", doc.customer, "custom_patient")
	if not patient:
		frappe.log_error(
			f"Insurance Claim not created for {doc.name}: no Patient on invoice or Customer.",
			"POS Insurance Claim",
		)
		return

	health_insurance = frappe.get_doc("Health Insurance", health_insurance_name)
	insurance_payor = getattr(health_insurance, "insurance_company", None)
	if not insurance_payor:
		frappe.log_error(
			f"Health Insurance {health_insurance_name} has no Insurance Company.",
			"POS Insurance Claim",
		)
		return

	claim = frappe.new_doc("Insurance Claim")
	claim.patient = patient
	claim.health_insurance = health_insurance_name
	claim.insurance_payor = insurance_payor
	claim.claim_date = today()
	claim.reference_doctype = "Sales Invoice"
	claim.reference_name = doc.name
	claim.sales_invoice = doc.name
	claim.status = "Draft"

	total_claimed = 0.0
	for si_item in doc.get("items", []):
		if not si_item.item_code:
			continue
		row = claim.append("claim_items", {})
		row.service_type = "Pharmacy"
		row.sales_invoice_item = si_item.item_code
		row.item_name = si_item.item_name or si_item.item_code
		gross = flt(getattr(si_item, "net_amount", None) or getattr(si_item, "amount", 0))
		row.gross_amount = gross
		row.covered_amount = gross
		row.co_pay_amount = 0
		row.non_covered_amount = 0
		row.patient_liability = 0
		total_claimed += gross

	claim.total_claimed = total_claimed
	claim.insert(ignore_permissions=True)

	# Set approved amount (insurance pays this from POS split)
	if frappe.db.has_column("Insurance Claim", "total_approved"):
		frappe.db.set_value(
			"Insurance Claim",
			claim.name,
			"total_approved",
			flt(insurance_amount),
			update_modified=False,
		)
		frappe.db.commit()

	# Submit claim so status becomes Submitted
	try:
		claim.reload()
		claim.submit()
	except Exception as e:
		frappe.log_error(
			frappe.get_traceback(),
			f"POS Insurance Claim submit failed: {claim.name}",
		)
