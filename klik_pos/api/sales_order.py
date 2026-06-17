import json

import frappe
from frappe.utils import flt, nowdate


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


def _update_medication_order_references(items):
	"""Write cart reference_no and alternative_drug back to Patient Medication Order child rows."""
	if not items:
		return

	updates_by_order = {}
	for item in items:
		order_name = item.get("medication_order")
		entry_name = item.get("medication_order_entry")
		if not order_name or not entry_name:
			continue
		if not frappe.db.exists("Patient Medication Order", order_name):
			continue

		payload = updates_by_order.setdefault(order_name, {}).setdefault(entry_name, {})
		if _to_bool_flag(item.get("is_pink")):
			reference_no = (item.get("reference_no") or "").strip()
			if reference_no:
				payload["reference_no"] = reference_no
		alternative_drug = (item.get("alternative_drug") or item.get("alternativeDrug") or "").strip()
		if alternative_drug:
			payload["alternative_drug"] = alternative_drug

	if not updates_by_order:
		return

	child_tables = [
		"medication_orders",
		"drug_prescription",
		"items",
		"drugs",
		"drug_prescription_detail",
	]

	for order_name, entry_map in updates_by_order.items():
		try:
			doc = frappe.get_doc("Patient Medication Order", order_name)
			updated = False
			for table_field in child_tables:
				if not doc.get(table_field):
					continue
				for row in doc.get(table_field):
					if row.name not in entry_map:
						continue
					for fieldname, value in entry_map[row.name].items():
						if hasattr(row, fieldname):
							setattr(row, fieldname, value)
							updated = True
			if updated:
				doc.save(ignore_permissions=True)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Failed to update medication order entry fields on {order_name}",
			)


def _mark_medication_orders_completed(order_names):
	if not order_names:
		return

	for order_name in order_names:
		if not frappe.db.exists("Patient Medication Order", order_name):
			continue
		try:
			doc = frappe.get_doc("Patient Medication Order", order_name)
			if hasattr(doc, "status"):
				doc.status = "Completed"
			doc.save(ignore_permissions=True)
		except Exception:
			# Fallback for stricter doctypes/workflows where save might fail
			try:
				frappe.db.set_value("Patient Medication Order", order_name, "status", "Completed", update_modified=True)
			except Exception:
				frappe.log_error(frappe.get_traceback(), f"Failed to set Completed on Medication Order {order_name}")


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
	Order: explicit payload -> first medication order's patient.
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
			_update_medication_order_references(items)
			_mark_medication_orders_completed(medication_orders)
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
