# Copyright (c) 2026, KLiK PoS and contributors
# Creates Insurance Claim from POS Sales Invoice after submit (Health Insurance + approved amount).

import frappe
from frappe import _
from frappe.utils import flt, today, getdate


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

	# Resolve patient: from Sales Invoice, else map the Customer to its Healthcare Patient.
	patient = getattr(doc, "patient", None)
	if not patient and doc.customer:
		from klik_pos.api.patient import resolve_patient_from_customer
		patient = resolve_patient_from_customer(doc.customer)
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
	# Insurance Claim auto-names from trans_no (INS/YYYY/#####); it must be set before insert.
	# Derive the next number from the actual max for the year (the naming Series counter is out of
	# sync with migrated claims), so we don't collide with an existing trans_no.
	year = getdate(today()).year
	prefix = f"INS/{year}/"
	last_num = frappe.db.sql(
		"""select coalesce(max(cast(substring_index(trans_no, '/', -1) as unsigned)), 0)
		   from `tabInsurance Claim` where trans_no like %s""",
		(prefix + "%",),
	)[0][0]
	claim.trans_no = f"{prefix}{int(last_num) + 1:05d}"
	claim.patient = patient
	claim.health_insurance = health_insurance_name
	claim.insurance_payor = insurance_payor
	claim.claim_date = today()
	claim.ip_op_source = "PH"
	claim.reference_doctype = "Sales Invoice"
	claim.reference_name = doc.name
	claim.sales_invoice = doc.name
	claim.status = "Draft"

	# Collect line grosses first so the insurance-covered amount can be allocated proportionally.
	item_rows = []
	total_gross = 0.0
	for si_item in doc.get("items", []):
		if not si_item.item_code:
			continue
		gross = flt(getattr(si_item, "net_amount", None) or getattr(si_item, "amount", 0))
		total_gross += gross
		item_rows.append((si_item, gross))

	insurance_amt = flt(insurance_amount)
	allocated = 0.0
	for idx, (si_item, gross) in enumerate(item_rows):
		row = claim.append("claim_items", {})
		row.service_type = "Pharmacy"
		row.sales_invoice_item = si_item.item_code
		row.item_name = si_item.item_name or si_item.item_code
		row.gross_amount = gross
		# Allocate the insurance-covered amount across lines in proportion to gross; the last line
		# absorbs the rounding remainder so covered amounts sum exactly to insurance_amount.
		if total_gross:
			covered = flt(insurance_amt - allocated) if idx == len(item_rows) - 1 else flt(gross * insurance_amt / total_gross)
		else:
			covered = 0.0
		covered = max(0.0, min(covered, gross))
		allocated += covered
		row.covered_amount = covered
		row.co_pay_amount = 0
		row.non_covered_amount = flt(gross - covered)
		row.patient_liability = flt(gross - covered)

	claim.total_claimed = total_gross
	claim.total_patient_liability = flt(max(0.0, total_gross - insurance_amt))
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
