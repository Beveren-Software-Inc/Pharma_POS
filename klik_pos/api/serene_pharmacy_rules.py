# Copyright (c) 2026, Klik POS contributors
"""Serene BRD pharmacy rules.

PHA-040  Active (undispensed) medicines return to pharmacy stock at discharge.
PHA-058  A pharmacy counter sale is recorded as a Patient Visit.
PHA-112  Periodic (monthly) refill reminders for specific customers.
PHA-116  Shelf / rack label - item name + retail price.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, nowdate

PHARMACY_VISIT_TYPE = "Pharmacy"
OPEN_LOT_STATUSES = ("Active", "Partially Sold")


# --------------------------------------------------------------------------- #
# PHA-040 - return unused medicine to pharmacy on discharge
# --------------------------------------------------------------------------- #
def _setting(field: str) -> int:
	return int(frappe.db.get_single_value("Healthcare Settings", field) or 0)


def _pharmacy_warehouse_for(cost_center: str | None) -> str | None:
	"""The pharmacy stock location serving a branch, taken from its POS Profile."""
	if not cost_center:
		return None
	return frappe.db.get_value(
		"POS Profile", {"custom_is_pharmacy": 1, "cost_center": cost_center}, "warehouse"
	)


def return_active_medicines_on_discharge(doc, method=None) -> None:
	"""Discharge `on_submit` hook - move unused dispensed stock back to the pharmacy."""
	if not _setting("return_active_medicines_on_discharge"):
		return

	admission = doc.get("admission_no") or doc.get("inpatient_admission") or doc.get("admission")
	if not admission:
		return

	lots = frappe.get_all(
		"Dispensing Lot",
		filters={
			"source_doctype": "Inpatient Admission",
			"source_document": admission,
			"status": ["in", OPEN_LOT_STATUSES],
			"remaining_qty": [">", 0],
		},
		fields=["name", "item", "item_name", "batch_no", "warehouse", "remaining_qty", "stock_uom"],
	)
	if not lots:
		return

	target = _pharmacy_warehouse_for(doc.get("cost_center"))
	if not target:
		frappe.log_error(
			title="PHA-040 medicine return skipped",
			message=f"No pharmacy warehouse for cost center {doc.get('cost_center')} "
			f"on discharge {doc.name}",
		)
		return

	items = []
	returned = []
	for lot in lots:
		if not lot.warehouse or lot.warehouse == target:
			continue
		items.append(
			{
				"item_code": lot.item,
				"qty": flt(lot.remaining_qty),
				"s_warehouse": lot.warehouse,
				"t_warehouse": target,
				"batch_no": lot.batch_no,
				"uom": lot.stock_uom,
				"stock_uom": lot.stock_uom,
				"conversion_factor": 1,
			}
		)
		returned.append(lot)

	if not items:
		return

	entry = frappe.new_doc("Stock Entry")
	entry.stock_entry_type = "Material Transfer"
	entry.purpose = "Material Transfer"
	entry.company = doc.get("company") or frappe.defaults.get_user_default("Company")
	entry.posting_date = nowdate()
	entry.remarks = _("Unused medicine returned to pharmacy on discharge {0}").format(doc.name)
	for row in items:
		entry.append("items", row)

	try:
		entry.insert(ignore_permissions=True)
		entry.submit()
	except Exception:
		frappe.log_error(
			title="PHA-040 medicine return failed",
			message=f"Discharge {doc.name}\n{frappe.get_traceback()}",
		)
		return

	for lot in returned:
		frappe.db.set_value("Dispensing Lot", lot.name, "status", "Inactive")

	doc.add_comment(
		"Info",
		_("{0} unused medicine line(s) returned to {1} via Stock Entry {2}").format(
			len(items), target, entry.name
		),
	)


# --------------------------------------------------------------------------- #
# PHA-058 - pharmacy sale recorded as a patient visit
# --------------------------------------------------------------------------- #
def create_pharmacy_patient_visit(doc, method=None) -> None:
	"""Sales Invoice `on_submit` hook for pharmacy POS sales."""
	if not _setting("record_pharmacy_sale_as_visit"):
		return
	if not doc.get("is_pos") or not doc.get("patient"):
		return
	if not frappe.db.get_value("POS Profile", doc.get("pos_profile"), "custom_is_pharmacy"):
		return
	if not frappe.db.exists("Patient Visit Type", PHARMACY_VISIT_TYPE):
		return
	if frappe.db.exists("Patient Visit", {"pharmacy_invoice": doc.name}):
		return

	visit = frappe.new_doc("Patient Visit")
	visit.patient = doc.patient
	visit.visit_type = PHARMACY_VISIT_TYPE
	visit.encounter_date = doc.get("posting_date") or nowdate()
	visit.status = "Completed"
	visit.company = doc.get("company")
	if visit.meta.has_field("cost_center"):
		visit.cost_center = doc.get("cost_center")
	if visit.meta.has_field("pharmacy_invoice"):
		visit.pharmacy_invoice = doc.name
	if visit.meta.has_field("visit_price"):
		visit.visit_price = 0

	try:
		# The pharmacy counter sale is a record of attendance, not a clinical
		# encounter, so the lab-request rule does not apply to it.
		visit.flags.ignore_mandatory = True
		visit.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(
			title="PHA-058 pharmacy visit failed",
			message=f"Sales Invoice {doc.name}\n{frappe.get_traceback()}",
		)


# --------------------------------------------------------------------------- #
# PHA-112 - periodic refill reminders
# --------------------------------------------------------------------------- #
def send_refill_reminders() -> int:
	"""Daily scheduler entry point for Medicine Refill Schedule."""
	if not frappe.db.exists("DocType", "Medicine Refill Schedule"):
		return 0

	today = getdate(nowdate())
	due = frappe.get_all(
		"Medicine Refill Schedule",
		filters={"is_active": 1, "next_refill_date": ["<=", add_days(today, 3)]},
		fields=[
			"name",
			"customer",
			"patient",
			"item",
			"item_name",
			"qty",
			"frequency_days",
			"next_refill_date",
			"notify_user",
			"contact_mobile",
		],
		limit_page_length=0,
	)

	sent = 0
	for row in due:
		recipient = row.notify_user or _pharmacy_notify_user()
		if recipient:
			frappe.get_doc(
				{
					"doctype": "Notification Log",
					"for_user": recipient,
					"type": "Alert",
					"document_type": "Medicine Refill Schedule",
					"document_name": row.name,
					"subject": _("Refill due: {0}").format(row.item_name or row.item),
					"email_content": _(
						"Refill for {0} ({1} x {2}) is due on {3}. Contact: {4}"
					).format(
						row.patient or row.customer,
						row.item_name or row.item,
						row.qty,
						row.next_refill_date,
						row.contact_mobile or "-",
					),
				}
			).insert(ignore_permissions=True)
			sent += 1

	if sent:
		frappe.db.commit()
	return sent


def _pharmacy_notify_user() -> str | None:
	users = frappe.get_all(
		"Has Role",
		filters={"role": "Pharmacist", "parenttype": "User"},
		pluck="parent",
	)
	for user in users:
		if user not in ("Administrator", "Guest") and frappe.db.get_value("User", user, "enabled"):
			return user
	return None


def advance_refill_schedule(doc, method=None) -> None:
	"""Roll the schedule forward when the refill is actually dispensed."""
	if not doc.get("is_pos") or not doc.get("patient"):
		return
	if not frappe.db.exists("DocType", "Medicine Refill Schedule"):
		return

	for item in doc.get("items") or []:
		schedules = frappe.get_all(
			"Medicine Refill Schedule",
			filters={"patient": doc.patient, "item": item.item_code, "is_active": 1},
			fields=["name", "frequency_days", "next_refill_date"],
		)
		for sched in schedules:
			days = int(sched.frequency_days or 30)
			base = getdate(doc.get("posting_date") or nowdate())
			frappe.db.set_value(
				"Medicine Refill Schedule",
				sched.name,
				{"last_refill_date": base, "next_refill_date": add_days(base, days)},
			)


# --------------------------------------------------------------------------- #
# PHA-116 - shelf / rack label
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def get_shelf_label_data(item_code: str, price_list: str | None = None) -> dict | None:
	"""Item name + retail price, for a shelf-edge / rack label."""
	if not item_code or not frappe.db.exists("Item", item_code):
		return None

	item = frappe.get_doc("Item", item_code)
	currency = (
		frappe.db.get_value("Company", frappe.defaults.get_user_default("Company"), "default_currency")
		or "BHD"
	)

	rate = 0.0
	if price_list:
		rate = flt(
			frappe.db.get_value(
				"Item Price",
				{"item_code": item_code, "price_list": price_list, "selling": 1},
				"price_list_rate",
			)
		)
	if not rate:
		rate = flt(
			frappe.db.get_value(
				"Item Price", {"item_code": item_code, "selling": 1}, "price_list_rate"
			)
		)
	if not rate:
		rate = flt(item.get("standard_rate") or 0)

	# Retail price on a shelf label must be what the customer pays, VAT included.
	tax_rate = 0.0
	if item.taxes:
		template = item.taxes[0].get("item_tax_template")
		if template:
			detail = frappe.get_all(
				"Item Tax Template Detail",
				filters={"parent": template},
				fields=["tax_rate"],
				limit=1,
			)
			if detail:
				tax_rate = flt(detail[0].tax_rate)

	retail = rate * (1 + tax_rate / 100)

	return {
		"item_code": item_code,
		"item_name": item.item_name,
		"description": (item.description or "").strip() or item.item_name,
		"uom": item.stock_uom,
		"item_group": item.item_group,
		"retail_price": frappe.format_value(
			retail, {"fieldtype": "Currency", "options": currency}
		),
		"retail_price_value": round(retail, 3),
		"currency": currency,
		"barcode": _first_barcode(item_code),
	}


@frappe.whitelist()
def get_shelf_labels_for_group(item_group: str, limit: int = 200) -> list[dict]:
	"""Bulk shelf labels - used when re-labelling a whole rack."""
	items = frappe.get_all(
		"Item",
		filters={"item_group": item_group, "disabled": 0},
		pluck="name",
		limit_page_length=limit,
	)
	return [label for label in (get_shelf_label_data(i) for i in items) if label]


def _first_barcode(item_code: str) -> str:
	return (
		frappe.db.get_value("Item Barcode", {"parent": item_code}, "barcode")
		or ""
	)
