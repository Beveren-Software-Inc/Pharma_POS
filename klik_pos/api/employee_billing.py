# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import flt, nowdate, strip_html_tags


def _to_bool(value):
	return value in (1, "1", True, "true", "True")


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
		fields = [f for f in fields if f == "name" or f in available]

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


def _get_or_create_employee_customer(employee_id):
	try:
		from healthcare.api.billing import _get_or_create_employee_customer as healthcare_get_customer

		return healthcare_get_customer(employee_id)
	except ImportError:
		pass

	employee_id = (employee_id or "").strip()
	if not employee_id:
		frappe.throw(_("Employee is required"))
	if not frappe.db.exists("Employee", employee_id):
		frappe.throw(_("Employee {0} not found").format(employee_id))

	employee = frappe.get_cached_doc("Employee", employee_id)
	display_name = (employee.employee_name or employee_id).strip()

	if frappe.db.exists("Customer", employee_id):
		current_name = frappe.db.get_value("Customer", employee_id, "customer_name")
		if current_name != display_name:
			frappe.db.set_value(
				"Customer", employee_id, "customer_name", display_name, update_modified=False
			)
		return employee_id

	legacy_name = frappe.db.get_value("Customer", {"customer_name": display_name}, "name")
	if legacy_name and legacy_name != employee_id:
		try:
			frappe.rename_doc("Customer", legacy_name, employee_id, force=True, merge=False)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Could not rename customer {legacy_name} to employee id {employee_id}",
			)
			return legacy_name
		return employee_id

	customer = frappe.new_doc("Customer")
	customer.customer_name = display_name
	customer.customer_type = "Individual"
	customer.customer_group = frappe.db.get_single_value("Selling Settings", "customer_group") or "Individual"
	customer.territory = frappe.db.get_single_value("Selling Settings", "territory") or "All Territories"
	customer.insert(ignore_permissions=True)

	if customer.name != employee_id:
		try:
			frappe.rename_doc("Customer", customer.name, employee_id, force=True, merge=False)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Could not rename new customer {customer.name} to employee id {employee_id}",
			)
			return customer.name

	return employee_id


def _apply_internal_employee_invoice_flags(invoice, employee_id):
	if frappe.db.has_column("Sales Invoice", "custom_internal_employee"):
		invoice.custom_internal_employee = 1
	if frappe.db.has_column("Sales Invoice", "custom_internal_employee_dispensing"):
		invoice.custom_internal_employee_dispensing = 1
	if employee_id and frappe.db.has_column("Sales Invoice", "custom_employee"):
		invoice.custom_employee = employee_id


def _create_unpaid_internal_employee_invoice_from_so(sales_order, employee_id, cost_center=None):
	"""Draft unpaid Sales Invoice from a submitted internal-employee dispensing Sales Order."""
	so = sales_order if hasattr(sales_order, "items") else frappe.get_doc("Sales Order", sales_order)

	try:
		from healthcare.api.sales_order_cost_center import (
			apply_cost_center_to_sales_invoice,
			cost_center_from_sales_order,
			sales_invoice_item_from_sales_order_item,
		)
	except ImportError:
		apply_cost_center_to_sales_invoice = None
		cost_center_from_sales_order = None
		sales_invoice_item_from_sales_order_item = None

	invoice = frappe.new_doc("Sales Invoice")
	invoice.customer = so.customer
	if so.company:
		invoice.company = so.company
	invoice.posting_date = nowdate()
	invoice.due_date = invoice.posting_date
	if hasattr(invoice, "update_stock"):
		invoice.update_stock = 0

	if getattr(so, "patient", None) and frappe.db.exists("Patient", so.patient):
		if frappe.get_meta("Sales Invoice").has_field("patient"):
			invoice.patient = so.patient

	_apply_internal_employee_invoice_flags(invoice, employee_id)

	so_cc = None
	if cost_center_from_sales_order:
		so_cc = cost_center_from_sales_order(so)
	so_cc = so_cc or cost_center
	if so_cc and apply_cost_center_to_sales_invoice:
		apply_cost_center_to_sales_invoice(invoice, so_cc)
	elif so_cc and hasattr(invoice, "cost_center"):
		invoice.cost_center = so_cc
		if hasattr(invoice, "custom_created_at"):
			invoice.custom_created_at = so_cc

	items_added = 0
	for item in so.items:
		if sales_invoice_item_from_sales_order_item:
			invoice.append("items", sales_invoice_item_from_sales_order_item(so, item))
		else:
			invoice.append(
				"items",
				{
					"item_code": item.item_code,
					"item_name": item.item_name or item.item_code,
					"qty": item.qty,
					"rate": item.rate,
					"uom": item.uom,
					"sales_order": so.name,
					"cost_center": getattr(item, "cost_center", None) or so_cc,
				},
			)
		items_added += 1

	if not items_added:
		frappe.throw(_("No items found on Sales Order {0}").format(so.name))

	invoice.insert(ignore_permissions=True)
	return invoice.name


@frappe.whitelist()
def create_employee_dispense_invoice(data=None, employee=None, items=None, company=None, cost_center=None, patient=None):
	"""
	Dispense medicine to an employee from POS:
	- Get/create Customer (ID = Employee ID, name = employee display name)
	- Create submitted Sales Order (custom_is_pos + custom_internal_employee_dispensing)
	- Create submitted Delivery Note to consume stock
	- Optionally create draft unpaid Sales Invoice when POS Profile flag is set
	"""
	if isinstance(data, str):
		data = json.loads(data)
	if data is None and frappe.form_dict.get("data"):
		data = frappe.form_dict.get("data")
		if isinstance(data, str):
			data = json.loads(data)
	if isinstance(data, dict):
		employee = employee or data.get("employee")
		items = items or data.get("items")
		company = company or data.get("company")
		cost_center = cost_center or data.get("cost_center")
		patient = patient or data.get("patient")

	employee = employee or frappe.form_dict.get("employee")
	items = items or frappe.form_dict.get("items")
	company = company or frappe.form_dict.get("company")
	cost_center = cost_center or frappe.form_dict.get("cost_center")
	patient = patient or frappe.form_dict.get("patient")

	if isinstance(items, str):
		items = json.loads(items)

	employee = (employee or "").strip()
	if not employee:
		frappe.throw(_("Employee is required"))
	if not items:
		frappe.throw(_("Please add at least one item"))
	if not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee {0} not found").format(employee))

	from klik_pos.api.sales_order import (
		_create_and_submit_delivery_note_from_sales_order,
		_get_active_pos_profile,
	)

	pos_profile = _get_active_pos_profile()
	company = company or getattr(pos_profile, "company", None) or frappe.defaults.get_defaults().get("company")
	if not company:
		frappe.throw(_("Company is required"))

	cost_center = cost_center or getattr(pos_profile, "cost_center", None)
	if not cost_center:
		cost_center = frappe.db.get_value("Company", company, "cost_center")
	if not cost_center:
		frappe.throw(_("Cost center is required"))

	create_invoice_now = _to_bool(
		getattr(pos_profile, "custom_create_invoice_on_internal_dispensing", 0)
	)

	savepoint = "employee_dispense_so_dn"
	frappe.db.savepoint(savepoint)
	try:
		customer = _get_or_create_employee_customer(employee)

		doc = frappe.new_doc("Sales Order")
		doc.customer = customer
		doc.transaction_date = nowdate()
		doc.delivery_date = nowdate()
		doc.company = company

		if hasattr(doc, "set_warehouse") and getattr(pos_profile, "warehouse", None):
			doc.set_warehouse = pos_profile.warehouse
		if hasattr(doc, "reserve_stock"):
			doc.reserve_stock = 0

		if patient and frappe.db.exists("Patient", patient) and frappe.get_meta("Sales Order").has_field("patient"):
			doc.patient = patient

		if frappe.db.has_column("Sales Order", "custom_is_pos"):
			doc.custom_is_pos = 1
		if frappe.db.has_column("Sales Order", "custom_internal_employee_dispensing"):
			doc.custom_internal_employee_dispensing = 1

		try:
			from healthcare.api.sales_order_cost_center import apply_cost_center_to_sales_order

			apply_cost_center_to_sales_order(doc, cost_center)
		except ImportError:
			doc.cost_center = cost_center

		for row in items:
			if not isinstance(row, dict) or not row.get("item_code"):
				continue
			qty = flt(row.get("qty") or row.get("quantity") or 0)
			if qty <= 0:
				continue
			line = {
				"item_code": row.get("item_code"),
				"qty": qty,
				"rate": flt(row.get("rate") or row.get("price") or 0),
				"delivery_date": nowdate(),
			}
			if row.get("item_name"):
				line["item_name"] = row.get("item_name")
			if row.get("uom"):
				line["uom"] = row.get("uom")
			batch_no = row.get("batch_no") or row.get("batchNumber")
			if batch_no and frappe.db.has_column("Sales Order Item", "batch_no"):
				line["batch_no"] = batch_no
			serial_no = row.get("serial_no") or row.get("serialNumber")
			if serial_no and frappe.db.has_column("Sales Order Item", "serial_no"):
				line["serial_no"] = serial_no
			if cost_center and frappe.get_meta("Sales Order Item").has_field("cost_center"):
				line["cost_center"] = cost_center
			doc.append("items", line)

		if not doc.items:
			frappe.throw(_("Please add at least one valid item"))

		doc.insert(ignore_permissions=True)
		doc.submit()
		delivery_note_name = _create_and_submit_delivery_note_from_sales_order(doc.name, pos_profile)

		invoice_name = None
		if create_invoice_now:
			invoice_name = _create_unpaid_internal_employee_invoice_from_so(
				doc, employee, cost_center=cost_center
			)

	except Exception as exc:
		frappe.db.rollback(save_point=savepoint)
		frappe.log_error(frappe.get_traceback(), "Employee dispense failed")
		message = strip_html_tags(str(exc)) or str(exc)
		frappe.throw(_("Employee dispense failed: {0}").format(message))

	return {
		"name": invoice_name or doc.name,
		"sales_order_name": doc.name,
		"delivery_note_name": delivery_note_name,
		"sales_invoice_name": invoice_name,
		"customer": customer,
		"grand_total": doc.grand_total,
		"invoice_created": bool(invoice_name),
	}
