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


def _sales_order_item_meta():
	return frappe.get_meta("Sales Order Item")


def _sales_order_item_has_field(fieldname):
	meta = _sales_order_item_meta()
	return meta.has_field(fieldname) and frappe.db.has_column("Sales Order Item", fieldname)


def _get_sales_order_item_fetch_fields():
	"""Build Sales Order Item field list based on columns available on site."""
	fields = ["name", "item_code", "item_name", "qty", "rate", "uom"]
	for optional in (
		"batch_no",
		"serial_no",
		"custom_batch",
		"custom_dispensing_lot",
		"custom_dosage",
		"custom_prescription_frequency",
	):
		if _sales_order_item_has_field(optional):
			fields.append(optional)
	return fields


def _apply_hospital_so_item_hold_fields(row, item):
	"""Persist POS dispense line metadata on Sales Order Item for held orders."""
	batch_val = (
		item.get("batchNumber")
		or item.get("batch_no")
		or item.get("custom_batch")
	)
	if batch_val:
		if _sales_order_item_has_field("custom_batch"):
			row["custom_batch"] = batch_val
		elif _sales_order_item_has_field("batch_no"):
			row["batch_no"] = batch_val

	serial_val = item.get("serialNumber") or item.get("serial_no")
	if serial_val and _sales_order_item_has_field("serial_no"):
		row["serial_no"] = serial_val

	dispensing_lot = (
		item.get("dispensingLot")
		or item.get("dispensing_lot")
		or item.get("custom_dispensing_lot")
	)
	if dispensing_lot and _sales_order_item_has_field("custom_dispensing_lot"):
		row["custom_dispensing_lot"] = dispensing_lot

	dosage = item.get("dosage") or item.get("custom_dosage")
	if dosage is not None and str(dosage).strip() and _sales_order_item_has_field("custom_dosage"):
		row["custom_dosage"] = str(dosage).strip()

	frequency = (
		item.get("prescriptionDosage")
		or item.get("prescription_frequency")
		or item.get("custom_prescription_frequency")
	)
	if frequency and _sales_order_item_has_field("custom_prescription_frequency"):
		row["custom_prescription_frequency"] = frequency


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


def _resolve_pos_cost_center(pos_profile):
	"""Cost center from POS Profile, falling back to company default."""
	cost_center = getattr(pos_profile, "cost_center", None)
	if cost_center:
		return cost_center
	company = getattr(pos_profile, "company", None)
	if company:
		return frappe.db.get_value("Company", company, "cost_center")
	return None


def _apply_cost_center_to_sales_order(doc, cost_center):
	if not cost_center:
		return
	try:
		from healthcare.api.sales_order_cost_center import apply_cost_center_to_sales_order

		apply_cost_center_to_sales_order(doc, cost_center)
	except ImportError:
		if hasattr(doc, "cost_center"):
			doc.cost_center = cost_center
		if frappe.get_meta("Sales Order Item").has_field("cost_center"):
			for row in doc.get("items") or []:
				row.cost_center = cost_center


def _apply_cost_center_to_delivery_note(dn, cost_center):
	if not cost_center:
		return
	if hasattr(dn, "cost_center"):
		dn.cost_center = cost_center
	if frappe.get_meta("Delivery Note Item").has_field("cost_center"):
		for row in dn.get("items") or []:
			row.cost_center = cost_center


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


def _create_and_submit_delivery_note_from_sales_order(sales_order_name, pos_profile, cost_center=None):
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

	if not cost_center:
		try:
			from healthcare.api.sales_order_cost_center import cost_center_from_sales_order

			so_doc = frappe.get_doc("Sales Order", sales_order_name)
			cost_center = cost_center_from_sales_order(so_doc)
		except ImportError:
			cost_center = frappe.db.get_value("Sales Order", sales_order_name, "cost_center")
	if not cost_center:
		cost_center = _resolve_pos_cost_center(pos_profile)
	_apply_cost_center_to_delivery_note(dn, cost_center)

	dn.insert(ignore_permissions=True)
	dn.submit()
	return dn.name


def _apply_hospital_sales_order_fields(doc, data, pos_profile, cost_center):
	"""Populate header fields on a hospital POS Sales Order."""
	customer = (data.get("customer") or {}).get("id")
	if not customer:
		frappe.throw("Customer is required")

	doc.customer = customer
	doc.transaction_date = nowdate()
	doc.delivery_date = nowdate()

	if getattr(pos_profile, "company", None):
		doc.company = pos_profile.company
	if getattr(pos_profile, "currency", None):
		doc.currency = pos_profile.currency
	if hasattr(doc, "set_warehouse") and getattr(pos_profile, "warehouse", None):
		doc.set_warehouse = pos_profile.warehouse
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

	if not (reference_name or "").strip():
		frappe.throw(
			"Create a Patient Visit before dispensing. "
			"A Patient Visit or Inpatient Admission reference is required when hospital pharmacy is enabled."
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

	custom_remarks = (data.get("custom_remarks") or "").strip()
	if custom_remarks and frappe.db.has_column("Sales Order", "custom_remarks"):
		doc.custom_remarks = custom_remarks

	hold_payload = data.get("hold_payload")
	if hold_payload and frappe.db.has_column("Sales Order", "custom_pos_hold_data"):
		doc.custom_pos_hold_data = (
			hold_payload if isinstance(hold_payload, str) else json.dumps(hold_payload)
		)

	return medication_orders


def validate_dispense_quantities(items):
	"""Block dispensing more than the prescribed quantity on a medication-order line.

	Each cart line linked to a Patient Medication Order entry carries the qty being dispensed;
	the linked entry carries the prescribed ``quantity``. Dispensing more than was prescribed
	(e.g. 100 tablets against a script for 10) is rejected. When the prescribed quantity is
	unknown (0 / unset) we cannot validate, so we do not block.
	"""
	if not items:
		return
	for item in items:
		if not isinstance(item, dict):
			continue
		entry_name = (
			item.get("medication_order_entry") or item.get("medicationOrderEntry") or ""
		).strip()
		if not entry_name:
			continue
		if not frappe.db.exists("Inpatient Medication Order Entry", entry_name):
			continue
		prescribed = flt(
			frappe.db.get_value("Inpatient Medication Order Entry", entry_name, "quantity") or 0
		)
		if prescribed <= 0:
			continue
		dispense_qty = flt(item.get("quantity") or item.get("qty") or 0)
		if dispense_qty - prescribed > 0.001:
			drug = (
				item.get("drug_name")
				or item.get("item_name")
				or item.get("id")
				or item.get("item_code")
				or entry_name
			)
			frappe.throw(
				frappe._(
					"Cannot dispense {0} unit(s) of {1}: only {2} were prescribed on this medication order."
				).format(dispense_qty, drug, prescribed)
			)


def _append_hospital_sales_order_items(doc, items, pos_profile, cost_center):
	validate_dispense_quantities(items)
	for item in items:
		item_code = item.get("id") or item.get("item_code")
		if not item_code:
			continue
		qty = flt(item.get("quantity") or 0)
		rate = flt(item.get("price") or item.get("rate") or 0)
		# Skip non-positive quantities and reject negative prices (don't rely solely on core).
		if qty <= 0:
			continue
		if rate < 0:
			frappe.throw(frappe._("Item {0} has a negative price.").format(item_code))
		row = {
			"item_code": item_code,
			"qty": qty,
			"rate": rate,
			"delivery_date": nowdate(),
		}
		if item.get("uom"):
			row["uom"] = item.get("uom")
		item_tax_template = item.get("item_tax_template") or item.get("itemTaxTemplate")
		if (
			item_tax_template
			and getattr(pos_profile, "custom_allow_item_tax_template", 0)
			and _sales_order_item_meta().has_field("item_tax_template")
		):
			row["item_tax_template"] = item_tax_template

		_apply_hospital_so_item_hold_fields(row, item)

		if cost_center and _sales_order_item_meta().has_field("cost_center"):
			row["cost_center"] = cost_center

		doc.append("items", row)


def _parse_hold_payload(raw):
	if not raw:
		return None
	if isinstance(raw, dict):
		return raw
	if isinstance(raw, str):
		try:
			return json.loads(raw)
		except Exception:
			return None
	return None


def _visit_type_from_reference(reference_type):
	"""Map Healthcare reference doctype to OP / IP label for dispense history."""
	if not reference_type:
		return None
	rt = str(reference_type).strip().lower()
	if "patient visit" in rt:
		return "OP"
	if "inpatient" in rt:
		return "IP"
	return None


def _resolve_dispense_visit_type(order, hold_payload=None):
	"""Resolve OP/IP from Sales Order reference fields or held cart payload."""
	ref_type = getattr(order, "custom_reference_type", None) if hasattr(order, "custom_reference_type") else None

	if not ref_type and hold_payload:
		visit_ref = hold_payload.get("created_visit_ref")
		if isinstance(visit_ref, dict) and visit_ref.get("doctype"):
			ref_type = visit_ref.get("doctype")

	if not ref_type:
		ref_type, _ = _derive_reference_from_medication_orders(
			ref_type,
			getattr(order, "custom_reference_name", None) if hasattr(order, "custom_reference_name") else None,
			_normalize_medication_orders(
				{
					"base_reference_name": getattr(order, "custom_base_reference_name", None)
					if hasattr(order, "custom_base_reference_name")
					else None
				}
			),
		)

	return _visit_type_from_reference(ref_type)


@frappe.whitelist()
def create_and_submit_hospital_sales_order(data):
	try:
		from klik_pos.klik_pos.utils import require_pos_access
		require_pos_access()

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

		from klik_pos.api.batch_expiry import validate_pos_items_batch_expiry

		validate_pos_items_batch_expiry(items)

		pos_profile = _get_active_pos_profile()
		if not _to_bool(getattr(pos_profile, "custom_is_hospital_pharmacy", 0)):
			frappe.throw("Hospital pharmacy flow is not enabled on current POS Profile.")

		cost_center = _resolve_pos_cost_center(pos_profile)

		draft_sales_order_name = (data.get("draft_sales_order_name") or "").strip()
		if draft_sales_order_name:
			if not frappe.db.exists("Sales Order", draft_sales_order_name):
				frappe.throw("Held dispense order not found.")
			doc = frappe.get_doc("Sales Order", draft_sales_order_name)
			if doc.docstatus != 0:
				frappe.throw("Only held (draft) dispense orders can be resumed.")
			if not _to_bool(getattr(doc, "custom_is_pos", 0)):
				frappe.throw("This is not a POS dispense order.")
			doc.items = []
		else:
			doc = frappe.new_doc("Sales Order")

		medication_orders = _apply_hospital_sales_order_fields(doc, data, pos_profile, cost_center)
		_append_hospital_sales_order_items(doc, items, pos_profile, cost_center)
		_apply_cost_center_to_sales_order(doc, cost_center)

		savepoint = "hospital_dispense_so_dn"
		frappe.db.savepoint(savepoint)
		try:
			if draft_sales_order_name:
				doc.save(ignore_permissions=True)
			else:
				doc.insert(ignore_permissions=True)
			doc.submit()

			delivery_note_name = _create_and_submit_delivery_note_from_sales_order(
				doc.name, pos_profile, cost_center=cost_center
			)
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
def create_draft_hospital_sales_order(data):
	"""Save a held hospital dispense cart as a draft Sales Order (not submitted)."""
	try:
		from klik_pos.klik_pos.utils import require_pos_access
		require_pos_access()

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

		from klik_pos.api.batch_expiry import validate_pos_items_batch_expiry

		validate_pos_items_batch_expiry(items)

		pos_profile = _get_active_pos_profile()
		if not _to_bool(getattr(pos_profile, "custom_is_hospital_pharmacy", 0)):
			frappe.throw("Hospital pharmacy flow is not enabled on current POS Profile.")

		cost_center = _resolve_pos_cost_center(pos_profile)
		draft_sales_order_name = (data.get("draft_sales_order_name") or "").strip()

		if draft_sales_order_name:
			if not frappe.db.exists("Sales Order", draft_sales_order_name):
				frappe.throw("Held dispense order not found.")
			doc = frappe.get_doc("Sales Order", draft_sales_order_name)
			if doc.docstatus != 0:
				frappe.throw("Only held (draft) dispense orders can be updated")
			if not _to_bool(getattr(doc, "custom_is_pos", 0)):
				frappe.throw("This is not a POS dispense order")
			doc.items = []
		else:
			doc = frappe.new_doc("Sales Order")

		_apply_hospital_sales_order_fields(doc, data, pos_profile, cost_center)
		_append_hospital_sales_order_items(doc, items, pos_profile, cost_center)
		_apply_cost_center_to_sales_order(doc, cost_center)

		if draft_sales_order_name:
			doc.save(ignore_permissions=True)
		else:
			doc.insert(ignore_permissions=True)

		return {
			"success": True,
			"sales_order_name": doc.name,
			"sales_order": {
				"name": doc.name,
				"customer": doc.customer,
				"status": doc.status,
				"docstatus": doc.docstatus,
			},
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Hospital Draft Sales Order Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def get_draft_hospital_sales_order(sales_order_name):
	"""Load a held draft hospital Sales Order for POS cart restore."""
	try:
		sales_order_name = (sales_order_name or "").strip()
		if not sales_order_name:
			frappe.throw("Sales order is required")
		if not frappe.db.exists("Sales Order", sales_order_name):
			frappe.throw("Sales order not found")

		doc = frappe.get_doc("Sales Order", sales_order_name)
		if doc.docstatus != 0:
			frappe.throw("Only held (draft) dispense orders can be edited")
		if not _to_bool(getattr(doc, "custom_is_pos", 0)):
			frappe.throw("This is not a POS dispense order")

		hold_payload = None
		if frappe.db.has_column("Sales Order", "custom_pos_hold_data"):
			hold_payload = _parse_hold_payload(getattr(doc, "custom_pos_hold_data", None))

		item_rows = frappe.get_all(
			"Sales Order Item",
			filters={"parent": sales_order_name},
			fields=_get_sales_order_item_fetch_fields(),
			order_by="idx asc",
		)

		return {
			"success": True,
			"sales_order_name": doc.name,
			"customer": doc.customer,
			"customer_name": doc.customer_name or doc.customer,
			"patient": getattr(doc, "patient", None),
			"custom_remarks": getattr(doc, "custom_remarks", None) if hasattr(doc, "custom_remarks") else None,
			"items": item_rows,
			"hold_payload": hold_payload,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Get draft hospital sales order error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def delete_draft_hospital_sales_order(sales_order_name):
	"""Delete a held draft hospital Sales Order."""
	try:
		sales_order_name = (sales_order_name or "").strip()
		if not sales_order_name:
			frappe.throw("Sales order is required")

		doc = frappe.get_doc("Sales Order", sales_order_name)
		if doc.docstatus != 0:
			frappe.throw("Only held (draft) dispense orders can be deleted")
		if not _to_bool(getattr(doc, "custom_is_pos", 0)):
			frappe.throw("This is not a POS dispense order")

		frappe.delete_doc("Sales Order", sales_order_name, ignore_permissions=True)
		return {"success": True, "sales_order_name": sales_order_name}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Delete draft hospital sales order error")
		return {"success": False, "message": str(e)}


def _get_pos_dispense_delivery_note(sales_order_name):
	"""Latest submitted non-return Delivery Note linked to a POS hospital Sales Order."""
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT dn.name
		FROM `tabDelivery Note` dn
		INNER JOIN `tabDelivery Note Item` dni ON dni.parent = dn.name
		WHERE dni.against_sales_order = %s
		  AND dn.docstatus = 1
		  AND IFNULL(dn.is_return, 0) = 0
		ORDER BY dn.creation DESC
		LIMIT 1
		""",
		sales_order_name,
		as_dict=True,
	)
	return rows[0].name if rows else None


def _get_dispense_dn_items_by_sales_order(order_names):
	"""Map Sales Order name -> list of Delivery Note Item rows (non-return DN)."""
	if not order_names:
		return {}

	rows = frappe.db.sql(
		"""
		SELECT
			dni.against_sales_order AS sales_order,
			dni.parent AS delivery_note,
			dni.name AS dn_detail,
			dni.so_detail,
			dni.item_code,
			dni.batch_no
		FROM `tabDelivery Note Item` dni
		INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
		WHERE dni.against_sales_order IN %(orders)s
		  AND dn.docstatus = 1
		  AND IFNULL(dn.is_return, 0) = 0
		""",
		{"orders": order_names},
		as_dict=True,
	)

	dn_items_map = {}
	for row in rows:
		dn_items_map.setdefault(row.sales_order, []).append(row)
	return dn_items_map


def _get_returned_qty_for_dn_item(delivery_note_name, customer, dn_detail):
	try:
		from erpnext.controllers.sales_and_purchase_return import get_returned_qty_map_for_row
	except ImportError:
		return 0

	returned = get_returned_qty_map_for_row(delivery_note_name, customer, dn_detail, "Delivery Note")
	if not returned:
		return 0
	return abs(flt(returned.get("qty") or 0))


def _annotate_dispense_return_status(order_items):
	"""Set per-line return_status and compute order-level dispense status."""
	total_qty = 0
	total_returned = 0
	returned_line_count = 0

	for item in order_items:
		qty = flt(item.get("qty") or 0)
		returned = flt(item.get("returned_qty") or 0)
		total_qty += qty
		total_returned += returned

		if returned <= 0:
			item["return_status"] = "none"
		elif returned >= qty:
			item["return_status"] = "full"
			returned_line_count += 1
		else:
			item["return_status"] = "partial"
			returned_line_count += 1

	if total_returned <= 0:
		status = "Dispensed medicine"
	elif total_returned >= total_qty:
		status = "Fully returned"
	else:
		status = "Partially returned"

	return status, returned_line_count


def _build_dispense_order_items(sales_order_name, customer):
	"""Sales Order items enriched with DN batch/return qty for POS view & history."""
	dn_items_by_order = _get_dispense_dn_items_by_sales_order([sales_order_name])
	dn_items = dn_items_by_order.get(sales_order_name, [])
	item_rows = frappe.get_all(
		"Sales Order Item",
		filters={"parent": sales_order_name},
		fields=["name", "item_code", "item_name", "qty", "rate", "amount", "description", "uom"],
		order_by="idx asc",
	)

	order_items = []
	for row in item_rows:
		dn_match = None
		for dn_item in dn_items:
			if dn_item.so_detail == row.name or (
				not dn_item.so_detail and dn_item.item_code == row.item_code
			):
				dn_match = dn_item
				break

		dn_detail = dn_match.dn_detail if dn_match else None
		item = {
			"name": row.name,
			"so_detail": row.name,
			"dn_detail": dn_detail,
			"item_code": row.item_code,
			"item_name": row.item_name,
			"description": row.description,
			"qty": row.qty,
			"rate": row.rate,
			"amount": row.amount,
			"uom": row.uom,
			"batch_no": dn_match.batch_no if dn_match else None,
			"returned_qty": 0,
			"available_qty": flt(row.qty),
		}
		order_items.append(item)

	delivery_note_name = _get_pos_dispense_delivery_note(sales_order_name)
	if not delivery_note_name and dn_items:
		delivery_note_name = dn_items[0].delivery_note

	if delivery_note_name:
		for item in order_items:
			if item.get("dn_detail"):
				item["returned_qty"] = _get_returned_qty_for_dn_item(
					delivery_note_name, customer, item["dn_detail"]
				)
				item["available_qty"] = max(
					0, flt(item.get("qty") or 0) - flt(item["returned_qty"] or 0)
				)

	dispense_status, returned_line_count = _annotate_dispense_return_status(order_items)
	can_return = 1 if (
		bool(delivery_note_name)
		and any(flt(item.get("available_qty") or 0) > 0 for item in order_items)
	) else 0

	return order_items, delivery_note_name, dispense_status, returned_line_count, can_return


def _get_dispense_order_billing_info(sales_order_name):
	"""
	Resolve linked Sales Invoice(s) and Payment Entry data for a hospital dispense SO.
	Billing happens after dispense (reception / healthcare), so the SO alone has no payment fields.
	"""
	invoices = frappe.db.sql(
		"""
		SELECT DISTINCT
			si.name,
			si.status,
			si.docstatus,
			si.grand_total,
			si.paid_amount,
			si.outstanding_amount,
			si.posting_date
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE sii.sales_order = %s
		  AND si.docstatus < 2
		ORDER BY si.creation DESC
		""",
		sales_order_name,
		as_dict=True,
	)

	if not invoices:
		# Advances recorded directly against the Sales Order
		so_payments = frappe.db.sql(
			"""
			SELECT pe.mode_of_payment, pe.paid_amount, pe.name AS payment_entry,
				per.allocated_amount
			FROM `tabPayment Entry Reference` per
			INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
			WHERE per.reference_doctype = 'Sales Order'
			  AND per.reference_name = %s
			  AND pe.docstatus = 1
			""",
			sales_order_name,
			as_dict=True,
		)
		if not so_payments:
			return {
				"sales_invoices": [],
				"sales_invoice": None,
				"invoice_status": None,
				"paid_amount": 0,
				"outstanding_amount": 0,
				"mode_of_payment": None,
				"payment_entries": [],
			}

		modes = []
		paid = 0
		for row in so_payments:
			paid += flt(row.allocated_amount or row.paid_amount or 0)
			if row.mode_of_payment and row.mode_of_payment not in modes:
				modes.append(row.mode_of_payment)
		return {
			"sales_invoices": [],
			"sales_invoice": None,
			"invoice_status": "Paid" if paid > 0 else None,
			"paid_amount": paid,
			"outstanding_amount": 0,
			"mode_of_payment": ", ".join(modes) if modes else None,
			"payment_entries": [row.payment_entry for row in so_payments if row.payment_entry],
		}

	invoice_names = [row.name for row in invoices]
	paid_amount = 0
	outstanding_amount = 0
	for inv in invoices:
		# Prefer grand_total - outstanding (PE updates outstanding more reliably than paid_amount)
		gt = flt(inv.grand_total or 0)
		out = flt(inv.outstanding_amount or 0)
		paid_amount += max(0, gt - out) if inv.docstatus == 1 else flt(inv.paid_amount or 0)
		outstanding_amount += out if inv.docstatus == 1 else gt

	# Primary invoice status: prefer Paid / Partly Paid over Draft
	status_priority = {
		"Paid": 5,
		"Credit Note Issued": 4,
		"Partly Paid": 3,
		"Overdue": 2,
		"Unpaid": 1,
		"Return": 1,
		"Draft": 0,
	}
	primary = max(
		invoices,
		key=lambda inv: (status_priority.get(inv.status or "", -1), inv.posting_date or ""),
	)
	invoice_status = primary.status if primary.docstatus == 1 else (primary.status or "Draft")

	# Payment modes from PE against those invoices
	pe_rows = frappe.db.sql(
		"""
		SELECT pe.mode_of_payment, pe.name AS payment_entry, per.allocated_amount
		FROM `tabPayment Entry Reference` per
		INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
		WHERE per.reference_doctype = 'Sales Invoice'
		  AND per.reference_name IN %(invoices)s
		  AND pe.docstatus = 1
		""",
		{"invoices": invoice_names},
		as_dict=True,
	)

	modes = []
	for row in pe_rows:
		if row.mode_of_payment and row.mode_of_payment not in modes:
			modes.append(row.mode_of_payment)

	# Fallback: Sales Invoice Payment child table (POS-style invoices)
	if not modes:
		si_payments = frappe.db.sql(
			"""
			SELECT DISTINCT mode_of_payment
			FROM `tabSales Invoice Payment`
			WHERE parent IN %(invoices)s
			  AND IFNULL(mode_of_payment, '') != ''
			""",
			{"invoices": invoice_names},
			as_dict=True,
		)
		modes = [row.mode_of_payment for row in si_payments if row.mode_of_payment]

	return {
		"sales_invoices": invoice_names,
		"sales_invoice": primary.name,
		"invoice_status": invoice_status,
		"paid_amount": paid_amount,
		"outstanding_amount": outstanding_amount,
		"mode_of_payment": ", ".join(modes) if modes else None,
		"payment_entries": [row.payment_entry for row in pe_rows if row.payment_entry],
	}


@frappe.whitelist()
def get_dispense_order_details(sales_order_name):
	"""
	Full POS hospital dispense order (Sales Order) details for the invoice/order view page.
	Returns a shape compatible with get_invoice_details so the same UI can render it.
	Enriches with linked Sales Invoice / Payment Entry when billing has been done.
	"""
	try:
		sales_order_name = (sales_order_name or "").strip()
		if not sales_order_name:
			frappe.throw("Sales order is required")
		if not frappe.db.exists("Sales Order", sales_order_name):
			frappe.throw(f"Sales Order {sales_order_name} not found")

		order = frappe.get_doc("Sales Order", sales_order_name)
		if not _to_bool(getattr(order, "custom_is_pos", 0)):
			frappe.throw("This is not a POS dispense order")

		is_held = int(order.docstatus or 0) == 0
		order_items, delivery_note_name, dispense_status, returned_line_count, can_return = (
			_build_dispense_order_items(order.name, order.customer)
		)
		if is_held:
			dispense_status = "Held"
			can_return = 0

		billing = _get_dispense_order_billing_info(order.name)
		# Prefer billing status (Paid / Unpaid / …) when an invoice exists; keep dispense_status for returns.
		display_status = billing.get("invoice_status") or dispense_status
		mode_of_payment = billing.get("mode_of_payment")
		if not mode_of_payment:
			mode_of_payment = "Unbilled" if not billing.get("sales_invoice") else "—"

		cashier_name = (
			frappe.db.get_value("User", order.owner, "full_name") or order.owner
		)
		hold_payload = (
			_parse_hold_payload(getattr(order, "custom_pos_hold_data", None))
			if hasattr(order, "custom_pos_hold_data")
			else None
		)
		remarks = getattr(order, "custom_remarks", None) or ""

		return {
			"success": True,
			"data": {
				"name": order.name,
				"customer": order.customer,
				"customer_name": order.customer_name or order.customer,
				"company": order.company,
				"currency": order.currency,
				"posting_date": order.transaction_date,
				"posting_time": "",
				"owner": order.owner,
				"cashier_name": cashier_name,
				"status": display_status,
				"dispense_status": dispense_status,
				"invoice_status": billing.get("invoice_status"),
				"docstatus": order.docstatus,
				"grand_total": order.grand_total,
				"base_grand_total": order.base_grand_total or order.grand_total,
				"total": order.total or order.grand_total,
				"net_total": order.net_total or order.total or order.grand_total,
				"total_taxes_and_charges": order.total_taxes_and_charges or 0,
				"rounding_adjustment": getattr(order, "rounding_adjustment", 0) or 0,
				"paid_amount": billing.get("paid_amount") or 0,
				"outstanding_amount": billing.get("outstanding_amount") or 0,
				"is_return": 0,
				"is_pos_dispense": 1,
				"is_held_dispense": 1 if is_held else 0,
				"paymentMethod": mode_of_payment,
				"mode_of_payment": mode_of_payment,
				"sales_invoice": billing.get("sales_invoice"),
				"sales_invoices": billing.get("sales_invoices") or [],
				"payment_entries": billing.get("payment_entries") or [],
				"delivery_note_name": delivery_note_name,
				"can_return": can_return,
				"returned_line_count": returned_line_count,
				"custom_remarks": remarks,
				"notes": remarks,
				"custom_reference_type": getattr(order, "custom_reference_type", None) or "",
				"custom_reference_name": getattr(order, "custom_reference_name", None) or "",
				"visit_type": _resolve_dispense_visit_type(order, hold_payload),
				"patient": getattr(order, "patient", None),
				"items": order_items,
				"taxes": [],
			},
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error fetching dispense order {sales_order_name}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_pos_dispense_history(limit=100, start=0, search="", cashier_name=None):
	"""List POS hospital dispense Sales Orders (submitted and held drafts)."""
	try:
		if not frappe.db.has_column("Sales Order", "custom_is_pos"):
			return {"success": True, "data": [], "total_count": 0}

		limit = int(limit or 100)
		start = int(start or 0)

		filters = {"custom_is_pos": 1, "docstatus": ["in", [0, 1]]}

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
			"docstatus",
		]
		if frappe.db.has_column("Sales Order", "custom_remarks"):
			fields.append("custom_remarks")
		if frappe.db.has_column("Sales Order", "custom_reference_type"):
			fields.append("custom_reference_type")
		if frappe.db.has_column("Sales Order", "custom_reference_name"):
			fields.append("custom_reference_name")
		if frappe.db.has_column("Sales Order", "custom_base_reference_name"):
			fields.append("custom_base_reference_name")
		if frappe.db.has_column("Sales Order", "custom_pos_hold_data"):
			fields.append("custom_pos_hold_data")

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

		dn_items_by_order = _get_dispense_dn_items_by_sales_order(order_names)

		items_map = {}
		if order_names:
			item_rows = frappe.get_all(
				"Sales Order Item",
				filters={"parent": ["in", order_names]},
				fields=["parent", "name", "item_code", "item_name", "qty", "rate", "amount", "uom"],
			)
			for row in item_rows:
				dn_match = None
				for dn_item in dn_items_by_order.get(row.parent, []):
					if dn_item.so_detail == row.name or (
						not dn_item.so_detail and dn_item.item_code == row.item_code
					):
						dn_match = dn_item
						break

				dn_detail = dn_match.dn_detail if dn_match else None

				items_map.setdefault(row.parent, []).append(
					{
						"so_detail": row.name,
						"dn_detail": dn_detail,
						"item_code": row.item_code,
						"item_name": row.item_name,
						"qty": row.qty,
						"rate": row.rate,
						"amount": row.amount,
						"uom": row.get("uom"),
						"batch_no": dn_match.batch_no if dn_match else None,
						"returned_qty": 0,
						"available_qty": flt(row.qty),
					}
				)

		data = []
		for order in orders:
			order_items = items_map.get(order.name, [])
			is_held = int(getattr(order, "docstatus", 1) or 0) == 0
			delivery_note_name = None
			can_return = 0
			returned_line_count = 0

			if is_held:
				dispense_status = "Held"
			else:
				delivery_note_name = _get_pos_dispense_delivery_note(order.name)
				if not delivery_note_name and dn_items_by_order.get(order.name):
					delivery_note_name = dn_items_by_order[order.name][0].delivery_note

				for item in order_items:
					if item.get("dn_detail") and delivery_note_name:
						item["returned_qty"] = _get_returned_qty_for_dn_item(
							delivery_note_name, order.customer, item["dn_detail"]
						)
						item["available_qty"] = max(0, flt(item.get("qty") or 0) - flt(item["returned_qty"] or 0))

				can_return = 1 if (
					bool(delivery_note_name)
					and any(flt(item.get("available_qty") or 0) > 0 for item in order_items)
				) else 0
				dispense_status, returned_line_count = _annotate_dispense_return_status(order_items)

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
					"status": dispense_status,
					"docstatus": order.docstatus,
					"returned_line_count": returned_line_count,
					"is_pos_dispense": 1,
					"is_held_dispense": 1 if is_held else 0,
					"mode_of_payment": "Dispensed medicine",
					"delivery_note_name": delivery_note_name,
					"can_return": can_return,
					"custom_remarks": getattr(order, "custom_remarks", None) or "",
					"custom_reference_type": getattr(order, "custom_reference_type", None) or "",
					"custom_reference_name": getattr(order, "custom_reference_name", None) or "",
					"visit_type": _resolve_dispense_visit_type(
						order,
						_parse_hold_payload(getattr(order, "custom_pos_hold_data", None))
						if hasattr(order, "custom_pos_hold_data")
						else None,
					),
					"items": order_items,
				}
			)

		return {"success": True, "data": data, "total_count": total_count}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching POS dispense history")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def create_dispense_return(sales_order_name, return_items):
	"""Create and submit a partial return Delivery Note against a hospital dispense order."""
	try:
		if isinstance(return_items, str):
			return_items = json.loads(return_items)

		if not sales_order_name:
			frappe.throw("Sales order is required.")
		if not return_items:
			frappe.throw("Select at least one item to return.")

		so = frappe.get_doc("Sales Order", sales_order_name)
		if so.docstatus != 1:
			frappe.throw("Only submitted dispense orders can be returned.")
		if not _to_bool(getattr(so, "custom_is_pos", 0)):
			frappe.throw("This is not a POS dispense order.")

		delivery_note_name = _get_pos_dispense_delivery_note(sales_order_name)
		if not delivery_note_name:
			frappe.throw("No delivery note found for this dispense order.")

		try:
			from erpnext.stock.doctype.delivery_note.delivery_note import make_sales_return
		except ImportError:
			frappe.throw("ERPNext is required to return dispensed medicine.")

		return_doc = make_sales_return(delivery_note_name)
		if isinstance(return_doc, dict):
			return_doc = frappe.get_doc(return_doc)

		return_rows_by_dn_detail = {}
		return_rows_by_so_detail = {}
		return_rows_by_item_code = {}
		for item in return_doc.items:
			if getattr(item, "dn_detail", None):
				return_rows_by_dn_detail[item.dn_detail] = item
			if getattr(item, "so_detail", None):
				return_rows_by_so_detail[item.so_detail] = item
			return_rows_by_item_code.setdefault(item.item_code, []).append(item)

		filtered_items = []
		seen_rows = set()
		for row in return_items:
			if isinstance(row, str):
				row = json.loads(row)
			requested_qty = flt(row.get("return_qty") or 0)
			if requested_qty <= 0:
				continue

			target_item = None
			if row.get("dn_detail"):
				target_item = return_rows_by_dn_detail.get(row["dn_detail"])
			if not target_item and row.get("so_detail"):
				target_item = return_rows_by_so_detail.get(row["so_detail"])
			if not target_item and row.get("item_code"):
				candidates = return_rows_by_item_code.get(row["item_code"], [])
				if len(candidates) == 1:
					target_item = candidates[0]
				elif candidates:
					for candidate in candidates:
						if candidate.so_detail and candidate.so_detail == row.get("so_detail"):
							target_item = candidate
							break
					if not target_item:
						target_item = candidates[0]

			if not target_item or target_item.name in seen_rows:
				continue

			max_returnable = abs(flt(target_item.qty))
			if requested_qty > max_returnable:
				frappe.throw(
					f"Cannot return {requested_qty} for {target_item.item_code}. "
					f"Maximum returnable quantity is {max_returnable}."
				)

			target_item.qty = -abs(requested_qty)
			if hasattr(target_item, "stock_qty") and flt(target_item.conversion_factor):
				target_item.stock_qty = target_item.qty * flt(target_item.conversion_factor)
			filtered_items.append(target_item)
			seen_rows.add(target_item.name)

		if not filtered_items:
			frappe.throw("Select at least one item to return.")

		return_doc.items = filtered_items
		return_doc.insert(ignore_permissions=True)
		return_doc.submit()

		return {
			"success": True,
			"return_delivery_note": return_doc.name,
			"sales_order_name": sales_order_name,
			"delivery_note_name": delivery_note_name,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Dispense return error")
		return {"success": False, "error": str(e)}
