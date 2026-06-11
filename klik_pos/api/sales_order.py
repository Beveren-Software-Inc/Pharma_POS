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
	"""Write cart reference_no back to pink Patient Medication Order child rows on dispense."""
	if not items:
		return

	updates_by_order = {}
	for item in items:
		if not _to_bool_flag(item.get("is_pink")):
			continue

		order_name = item.get("medication_order")
		entry_name = item.get("medication_order_entry")
		reference_no = (item.get("reference_no") or "").strip()
		if not order_name or not entry_name or not reference_no:
			continue
		if not frappe.db.exists("Patient Medication Order", order_name):
			continue

		updates_by_order.setdefault(order_name, {})[entry_name] = reference_no

	for order_name, entry_map in updates_by_order.items():
		try:
			doc = frappe.get_doc("Patient Medication Order", order_name)
			updated = False
			for row in doc.get("medication_orders") or []:
				if row.name in entry_map and hasattr(row, "reference_no"):
					row.reference_no = entry_map[row.name]
					updated = True
			if updated:
				doc.save(ignore_permissions=True)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Failed to update reference_no on Medication Order {order_name}",
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
