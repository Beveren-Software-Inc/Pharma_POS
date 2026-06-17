# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

import json

import frappe


@frappe.whitelist()
def search_employees(search_query: str = "", limit: int = 20):
	"""Search employees for internal medicine dispensing."""
	try:
		if not frappe.db.exists("DocType", "Employee"):
			return []

		try:
			limit = max(1, min(int(limit), 50))
		except Exception:
			limit = 20

		filters = {"status": "Active"}
		or_filters = None
		if search_query and search_query.strip():
			q = f"%{search_query.strip()}%"
			or_filters = [
				["employee_name", "like", q],
				["name", "like", q],
			]

		fields = ["name", "employee_name", "company", "department", "designation"]
		meta = frappe.get_meta("Employee")
		available = {f.fieldname for f in meta.fields}
		fields = [f for f in fields if f in available]

		return frappe.get_all(
			"Employee",
			fields=fields,
			filters=filters,
			or_filters=or_filters,
			order_by="employee_name asc",
			limit=limit,
		)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error searching employees")
		frappe.throw(f"Failed to search employees: {str(e)}")


@frappe.whitelist()
def create_employee_dispense_invoice(employee, items, company=None, cost_center=None, patient=None):
	"""
	Create an internal employee Sales Invoice from POS cart lines.
	Delegates to healthcare billing when available.
	"""
	if isinstance(items, str):
		items = json.loads(items)

	if not employee:
		frappe.throw("Employee is required")
	if not items:
		frappe.throw("Please add at least one item")

	company = company or frappe.defaults.get_defaults().get("company")
	if not company:
		frappe.throw("Company is required")

	if not cost_center:
		cost_center = frappe.db.get_value("POS Profile", {"company": company}, "cost_center")
	if not cost_center:
		cost_center = frappe.db.get_value("Company", company, "cost_center")
	if not cost_center:
		frappe.throw("Cost center is required")

	# Prefer healthcare internal employee billing when installed
	if frappe.db.exists("DocType", "Sales Invoice") and frappe.db.has_column(
		"Sales Invoice", "custom_internal_employee"
	):
		try:
			from healthcare.api.billing import create_internal_employee_invoice

			return create_internal_employee_invoice(
				employee_name=employee,
				company=company,
				created_at_cost_center=cost_center,
				items=items,
				patient=patient,
			)
		except ImportError:
			pass

	# Fallback: plain Sales Invoice for employee customer
	customer = _get_or_create_employee_customer(employee)
	invoice = frappe.new_doc("Sales Invoice")
	invoice.company = company
	invoice.customer = customer
	if patient and frappe.db.exists("Patient", patient):
		invoice.patient = patient
	if frappe.db.has_column("Sales Invoice", "custom_internal_employee"):
		invoice.custom_internal_employee = 1
	if frappe.db.has_column("Sales Invoice", "custom_created_at"):
		invoice.custom_created_at = cost_center

	for row in items:
		if not isinstance(row, dict) or not row.get("item_code"):
			continue
		qty = float(row.get("qty") or row.get("quantity") or 0)
		if qty <= 0:
			continue
		line = {
			"item_code": row.get("item_code"),
			"qty": qty,
			"rate": float(row.get("rate") or row.get("price") or 0),
		}
		if row.get("uom"):
			line["uom"] = row.get("uom")
		if row.get("batch_no") or row.get("batchNumber"):
			line["batch_no"] = row.get("batch_no") or row.get("batchNumber")
		if row.get("serial_no") or row.get("serialNumber"):
			line["serial_no"] = row.get("serial_no") or row.get("serialNumber")
		invoice.append("items", line)

	if not invoice.items:
		frappe.throw("Please add at least one valid item")

	invoice.insert(ignore_permissions=True)
	return {"name": invoice.name, "customer": invoice.customer, "grand_total": invoice.grand_total}


def _get_or_create_employee_customer(employee_name):
	employee = frappe.get_doc("Employee", employee_name)
	customer_name = f"Employee - {employee.employee_name or employee.name}"
	existing = frappe.db.get_value("Customer", {"customer_name": customer_name})
	if existing:
		return existing

	customer = frappe.new_doc("Customer")
	customer.customer_name = customer_name
	customer.customer_type = "Individual"
	customer.customer_group = frappe.db.get_single_value("Selling Settings", "customer_group") or "Individual"
	customer.territory = frappe.db.get_single_value("Selling Settings", "territory") or "All Territories"
	customer.insert(ignore_permissions=True)
	return customer.name
