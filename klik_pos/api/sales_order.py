import json

import frappe
from frappe.utils import flt, nowdate

from klik_pos.api.patient import resolve_patient_from_customer


def _to_bool(value):
	return value in (1, "1", True, "true", "True")


def _get_active_pos_profile():
	current_opening_entry = frappe.db.get_value(
		"POS Opening Entry",
		{"user": frappe.session.user, "docstatus": 1, "status": "Open"},
		"name",
		order_by="creation desc",
	)
	if current_opening_entry:
		profile_name = frappe.db.get_value("POS Opening Entry", current_opening_entry, "pos_profile")
		if profile_name:
			return frappe.get_doc("POS Profile", profile_name)

	default_profile = frappe.db.get_value("POS Profile User", {"user": frappe.session.user}, "parent")
	if default_profile:
		return frappe.get_doc("POS Profile", default_profile)
	return frappe.get_doc("POS Profile", frappe.get_all("POS Profile", fields=["name"], limit=1)[0].name)


def _normalize_medication_orders(data):
	orders = data.get("medication_orders") or []
	if isinstance(orders, str):
		orders = [o.strip() for o in orders.split(",") if o and o.strip()]
	elif not isinstance(orders, list):
		orders = [orders]

	# Backward compatibility from base_reference_name CSV
	if not orders:
		base_reference_name = data.get("base_reference_name")
		if isinstance(base_reference_name, str):
			orders = [o.strip() for o in base_reference_name.split(",") if o and o.strip()]

	return [o for o in orders if isinstance(o, str) and o.strip()]


def _normalize_batch_nos(batch_nos):
	if isinstance(batch_nos, str):
		batch_nos = [b.strip() for b in batch_nos.split(",") if b and b.strip()]
	elif not isinstance(batch_nos, list):
		batch_nos = [batch_nos]

	return [b for b in batch_nos if isinstance(b, str) and b.strip()]


def _to_bool_flag(value):
	return value in (1, "1", True, "true", "True")


def _get_alternative_medicine_fieldname():
	"""Child-row field for the dispensed alternative item (Healthcare: alternative_medicine)."""
	cache_key = "_pmo_alternative_medicine_field"
	cached = getattr(frappe.local, cache_key, None)
	if cached is not None:
		return cached or None

	fieldname = None
	try:
		meta = frappe.get_meta("Inpatient Medication Order Entry")
		if meta.has_field("alternative_medicine"):
			fieldname = "alternative_medicine"
		elif meta.has_field("alternative_drug"):
			fieldname = "alternative_drug"
	except Exception:
		pass

	setattr(frappe.local, cache_key, fieldname or "")
	return fieldname


def _resolve_medication_order_name(item):
	order_name = (item.get("medication_order") or item.get("medicationOrder") or "").strip()
	if order_name:
		return order_name

	for key in ("medication_orders", "medicationOrders"):
		orders = item.get(key)
		if isinstance(orders, list):
			for entry in orders:
				if isinstance(entry, str) and entry.strip():
					return entry.strip()
		elif isinstance(orders, str) and orders.strip():
			return orders.strip()

	return None


def _extract_alternative_item_code(item):
	alternative_item = (
		item.get("alternative_medicine")
		or item.get("alternative_drug")
		or item.get("alternativeDrug")
		or item.get("alternative_item_code")
		or ""
	).strip()
	if alternative_item:
		return alternative_item

	original_drug = (item.get("original_drug") or item.get("originalDrug") or "").strip()
	dispensed_item = (item.get("id") or item.get("item_code") or "").strip()
	if original_drug and dispensed_item and original_drug != dispensed_item:
		return dispensed_item

	return ""


def _build_medication_order_entry_updates(items):
	"""Map PMO child row names to field updates for dispensed lines."""
	if not items:
		return {}

	alternative_field = _get_alternative_medicine_fieldname()
	child_meta = frappe.get_meta("Inpatient Medication Order Entry")
	updates_by_order = {}

	for item in items:
		order_name = _resolve_medication_order_name(item)
		entry_name = (item.get("medication_order_entry") or item.get("medicationOrderEntry") or "").strip()
		if not order_name or not entry_name:
			continue
		if not frappe.db.exists("Patient Medication Order", order_name):
			continue

		payload = updates_by_order.setdefault(order_name, {}).setdefault(entry_name, {})

		if child_meta.has_field("is_completed"):
			payload["is_completed"] = 1

		if _to_bool_flag(item.get("is_pink")):
			reference_no = (item.get("reference_no") or "").strip()
			if reference_no:
				payload["reference_no"] = reference_no

		alternative_item = _extract_alternative_item_code(item)
		if alternative_item and alternative_field:
			payload[alternative_field] = alternative_item
			if (
				alternative_field == "alternative_medicine"
				and child_meta.has_field("alternative_medicine_name")
			):
				payload["alternative_medicine_name"] = (
					frappe.db.get_value("Item", alternative_item, "item_name") or alternative_item
				)

	return updates_by_order


def _set_child_entry_fields(entry_name, payload):
	if not entry_name or not payload:
		return

	child_meta = frappe.get_meta("Inpatient Medication Order Entry")
	for fieldname, value in payload.items():
		if not child_meta.has_field(fieldname):
			continue
		frappe.db.set_value(
			"Inpatient Medication Order Entry",
			entry_name,
			fieldname,
			value,
			update_modified=True,
		)


def _sync_patient_medication_order_progress(order_name):
	"""Recount completed child rows and refresh parent status (Healthcare set_status)."""
	if not frappe.db.exists("Patient Medication Order", order_name):
		return

	try:
		doc = frappe.get_doc("Patient Medication Order", order_name)
		total_orders = len(doc.get("medication_orders") or [])
		if doc.meta.has_field("total_orders"):
			doc.db_set("total_orders", total_orders, update_modified=False)

		completed_orders = frappe.db.count(
			"Inpatient Medication Order Entry",
			{"parent": order_name, "is_completed": 1},
		)
		doc.completed_orders = completed_orders
		doc.db_set("completed_orders", completed_orders, update_modified=False)
		doc.set_status()
	except Exception:
		frappe.log_error(
			frappe.get_traceback(),
			f"Failed to sync completion progress on Patient Medication Order {order_name}",
		)


def _finalize_medication_orders_after_dispense(items, medication_orders):
	"""Mark dispensed child rows complete and sync PMO completed_orders/status."""
	updates_by_order = _build_medication_order_entry_updates(items)

	for order_name, entry_map in updates_by_order.items():
		for entry_name, payload in entry_map.items():
			try:
				_set_child_entry_fields(entry_name, payload)
			except Exception:
				frappe.log_error(
					frappe.get_traceback(),
					f"Failed to update PMO entry {entry_name} on {order_name}",
				)

	orders_to_sync = set(medication_orders or [])
	orders_to_sync.update(updates_by_order.keys())

	for order_name in orders_to_sync:
		_sync_patient_medication_order_progress(order_name)


def _derive_reference_from_medication_orders(reference_type, reference_name, medication_orders):
	"""
	If reference_name wasn't provided by frontend, derive it from Patient Medication Order:
	- patient_encounter -> Patient Visit
	- inpatient_record -> Inpatient Admission
	"""
	if reference_name:
		return reference_type, reference_name

	if not medication_orders:
		return reference_type, reference_name

	first_order = medication_orders[0]
	if not frappe.db.exists("Patient Medication Order", first_order):
		return reference_type, reference_name

	try:
		order_doc = frappe.get_doc("Patient Medication Order", first_order)
		patient_visit = getattr(order_doc, "patient_encounter", None)
		inpatient_admission = getattr(order_doc, "inpatient_record", None)

		if patient_visit:
			return "Patient Visit", patient_visit
		if inpatient_admission:
			return "Inpatient Admission", inpatient_admission
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Failed deriving reference from Medication Order {first_order}")

	return reference_type, reference_name


def _resolve_patient_for_hospital_order(data, medication_orders):
	"""
	Link Sales Order to Patient (Healthcare) when field exists.
	Order: explicit payload -> medication order's patient -> customer link.
	"""
	patient = (data.get("patient") or data.get("patient_id") or "").strip()
	if patient and frappe.db.exists("Patient", patient):
		return patient

	if medication_orders:
		first = medication_orders[0]
		if frappe.db.exists("Patient Medication Order", first):
			p = frappe.db.get_value("Patient Medication Order", first, "patient")
			if p and frappe.db.exists("Patient", p):
				return p

	customer = data.get("customer")
	if isinstance(customer, dict):
		customer = customer.get("id") or customer.get("name")
	customer = (customer or "").strip()
	if customer:
		return resolve_patient_from_customer(customer)

	return None


@frappe.whitelist()
def get_batch_label_details(batch_nos):
	try:
		normalized_batch_nos = _normalize_batch_nos(batch_nos)
		if not normalized_batch_nos:
			return {}

		batches = frappe.get_all(
			"Batch",
			filters={"name": ["in", normalized_batch_nos]},
			fields=["name", "batch_id", "expiry_date"],
		)

		if len(batches) < len(normalized_batch_nos):
			existing_names = {b.get("name") for b in batches}
			missing = [b for b in normalized_batch_nos if b not in existing_names]
			if missing:
				batches.extend(
					frappe.get_all(
						"Batch",
						filters={"batch_id": ["in", missing]},
						fields=["name", "batch_id", "expiry_date"],
					)
				)

		result = {}
		for batch in batches:
			entry = {
				"batch_no": batch.get("batch_id") or batch.get("name"),
				"expiry_date": str(batch.get("expiry_date")) if batch.get("expiry_date") else None,
			}
			if batch.get("name"):
				result[batch.get("name")] = entry
			if batch.get("batch_id"):
				result[batch.get("batch_id")] = entry

		return result
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Get batch label details error")
		return {}


def _create_and_submit_delivery_note_from_sales_order(sales_order_name, pos_profile):
	"""Create submitted Delivery Note from Sales Order so stock updates immediately (not long SO reservation)."""
	try:
		from erpnext.selling.doctype.sales_order.sales_order import make_delivery_note
	except ImportError:
		frappe.throw("ERPNext is required to create Delivery Note from Sales Order.")

	dn = make_delivery_note(sales_order_name)
	if isinstance(dn, dict):
		dn = frappe.get_doc(dn)

	warehouse = getattr(pos_profile, "warehouse", None)
	if warehouse:
		if hasattr(dn, "set_warehouse"):
			dn.set_warehouse = warehouse
		for row in dn.get("items") or []:
			if not getattr(row, "warehouse", None):
				row.warehouse = warehouse

	if hasattr(dn, "update_stock"):
		dn.update_stock = 1

	dn.insert(ignore_permissions=True)
	dn.submit()
	return dn.name


@frappe.whitelist()
def create_and_submit_hospital_sales_order(data):
	try:
		if isinstance(data, str):
			data = json.loads(data)
		if not data:
			frappe.throw("No data provided")

		customer = (data.get("customer") or {}).get("id")
		items = data.get("items") or []
		if not customer:
			frappe.throw("Customer is required")
		if not items:
			frappe.throw("At least one item is required")

		pos_profile = _get_active_pos_profile()
		if not _to_bool(getattr(pos_profile, "custom_is_hospital_pharmacy", 0)):
			frappe.throw("Hospital pharmacy flow is not enabled on current POS Profile.")

		doc = frappe.new_doc("Sales Order")
		doc.customer = customer
		doc.transaction_date = nowdate()
		doc.delivery_date = nowdate()

		if getattr(pos_profile, "company", None):
			doc.company = pos_profile.company
		if getattr(pos_profile, "currency", None):
			doc.currency = pos_profile.currency
		if hasattr(doc, "set_warehouse") and getattr(pos_profile, "warehouse", None):
			doc.set_warehouse = pos_profile.warehouse
		# Stock is updated via submitted Delivery Note right after SO; avoid long-lived reservation only.
		if hasattr(doc, "reserve_stock"):
			doc.reserve_stock = 0

		base_reference = data.get("base_reference") or "Patient Medication Order"
		base_reference_name = data.get("base_reference_name")
		medication_orders = _normalize_medication_orders(data)
		reference_type = data.get("reference_type")
		reference_name = data.get("reference_name")
		reference_type, reference_name = _derive_reference_from_medication_orders(
			reference_type, reference_name, medication_orders
		)

		if frappe.db.has_column("Sales Order", "custom_base_reference"):
			doc.custom_base_reference = base_reference
		if base_reference_name and frappe.db.has_column("Sales Order", "custom_base_reference_name"):
			doc.custom_base_reference_name = base_reference_name
		if reference_type and frappe.db.has_column("Sales Order", "custom_reference_type"):
			doc.custom_reference_type = reference_type
		if reference_name and frappe.db.has_column("Sales Order", "custom_reference_name"):
			doc.custom_reference_name = reference_name

		patient_link = _resolve_patient_for_hospital_order(data, medication_orders)
		if patient_link and frappe.get_meta("Sales Order").has_field("patient"):
			doc.patient = patient_link

		if frappe.db.has_column("Sales Order", "custom_is_pos"):
			doc.custom_is_pos = 1

		for item in items:
			item_code = item.get("id") or item.get("item_code")
			if not item_code:
				continue
			row = {
				"item_code": item_code,
				"qty": flt(item.get("quantity") or 0),
				"rate": flt(item.get("price") or item.get("rate") or 0),
				"delivery_date": nowdate(),
			}
			if item.get("uom"):
				row["uom"] = item.get("uom")
			if item.get("batchNumber") and frappe.db.has_column("Sales Order Item", "batch_no"):
				row["batch_no"] = item.get("batchNumber")
			if item.get("serialNumber") and frappe.db.has_column("Sales Order Item", "serial_no"):
				row["serial_no"] = item.get("serialNumber")

			doc.append("items", row)

		savepoint = "hospital_dispense_so_dn"
		frappe.db.savepoint(savepoint)
		try:
			doc.insert(ignore_permissions=True)
			doc.submit()

			delivery_note_name = _create_and_submit_delivery_note_from_sales_order(doc.name, pos_profile)
			_finalize_medication_orders_after_dispense(items, medication_orders)
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			raise

		return {
			"success": True,
			"sales_order_name": doc.name,
			"delivery_note_name": delivery_note_name,
			"sales_order": {
				"name": doc.name,
				"customer": doc.customer,
				"status": doc.status,
				"docstatus": doc.docstatus,
			},
			"completed_medication_orders": medication_orders,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Hospital Sales Order Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def get_pos_dispense_history(limit=100, start=0, search="", cashier_name=None):
	"""List submitted Sales Orders created from POS hospital dispensing (custom_is_pos)."""
	try:
		if not frappe.db.has_column("Sales Order", "custom_is_pos"):
			return {"success": True, "data": [], "total_count": 0}

		limit = int(limit or 100)
		start = int(start or 0)

		filters = {"custom_is_pos": 1, "docstatus": 1}

		if cashier_name and cashier_name != "all":
			from klik_pos.api.sales_invoice import _get_user_ids_by_full_name

			cashier_user_ids = _get_user_ids_by_full_name(cashier_name)
			if not cashier_user_ids:
				return {"success": True, "data": [], "total_count": 0}
			filters["owner"] = cashier_user_ids[0] if len(cashier_user_ids) == 1 else ["in", cashier_user_ids]

		or_filters = None
		if search and str(search).strip():
			search_term = str(search).strip()
			or_filters = [
				["name", "like", f"%{search_term}%"],
				["customer_name", "like", f"%{search_term}%"],
				["customer", "like", f"%{search_term}%"],
			]

		fields = [
			"name",
			"transaction_date",
			"owner",
			"customer",
			"customer_name",
			"grand_total",
			"currency",
			"status",
			"modified",
		]

		orders = frappe.get_all(
			"Sales Order",
			filters=filters,
			or_filters=or_filters,
			fields=fields,
			order_by="modified desc",
			limit=limit,
			start=start,
		)

		total_count = frappe.db.count("Sales Order", filters=filters)

		order_names = [row.name for row in orders]
		user_ids = list({row.owner for row in orders if row.owner})

		cashier_names_map = {}
		if user_ids:
			users = frappe.get_all("User", filters={"name": ["in", user_ids]}, fields=["name", "full_name"])
			cashier_names_map = {u.name: u.full_name or u.name for u in users}

		items_map = {}
		if order_names:
			item_rows = frappe.get_all(
				"Sales Order Item",
				filters={"parent": ["in", order_names]},
				fields=["parent", "item_code", "item_name", "qty", "rate", "amount"],
			)
			for row in item_rows:
				items_map.setdefault(row.parent, []).append(
					{
						"item_code": row.item_code,
						"item_name": row.item_name,
						"qty": row.qty,
						"rate": row.rate,
						"amount": row.amount,
					}
				)

		data = []
		for order in orders:
			data.append(
				{
					"name": order.name,
					"posting_date": order.transaction_date,
					"posting_time": "",
					"owner": order.owner,
					"cashier_name": cashier_names_map.get(order.owner, order.owner),
					"customer": order.customer,
					"customer_name": order.customer_name or order.customer,
					"base_grand_total": order.grand_total,
					"currency": order.currency,
					"erp_status": order.status,
					"status": "Dispensed medicine",
					"is_pos_dispense": 1,
					"mode_of_payment": "Dispensed medicine",
					"items": items_map.get(order.name, []),
				}
			)

		return {"success": True, "data": data, "total_count": total_count}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching POS dispense history")
		return {"success": False, "error": str(e)}
