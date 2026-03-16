# Copyright (c) 2026, KLiK PoS and contributors
# For license information, please see license.txt

"""
Health Insurance (Healthcare module) integration for POS.
Fetches Health Insurance list and details for insurance payment flow.
"""

import frappe
from frappe import _
from frappe.utils import flt


@frappe.whitelist()
def get_health_insurance_list():
	"""
	Return list of Health Insurance docs with name, insurance_company,
	insurance_coverage_ (%), and mode_of_payment for POS insurance split.
	Requires Healthcare app and Health Insurance DocType.
	"""
	try:
		if not frappe.db.exists("DocType", "Health Insurance"):
			return {"success": False, "message": "Health Insurance DocType not found. Install Healthcare app."}
		has_coverage = frappe.db.has_column("Health Insurance", "insurance_coverage_")
		has_mop = frappe.db.has_column("Health Insurance", "mode_of_payment")
		fields = ["name", "insurance_company"]
		if has_coverage:
			fields.append("insurance_coverage_")
		if has_mop:
			fields.append("mode_of_payment")
		rows = frappe.get_all(
			"Health Insurance",
			fields=fields,
			filters={"name": ["!=", ""]},
			order_by="insurance_company asc",
		)
		for r in rows:
			if has_coverage:
				r["insurance_coverage_"] = flt(r.get("insurance_coverage_") or 0)
			else:
				r["insurance_coverage_"] = 0
			if not has_mop:
				r["mode_of_payment"] = None
		return {"success": True, "data": rows}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Health Insurance List Error")
		return {"success": False, "message": str(e)}
