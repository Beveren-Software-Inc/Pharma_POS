# Copyright (c) 2026, Beveren Software and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_days, getdate, today

# Warn when batch expires within this many days (frontend also uses 90).
NEAR_EXPIRY_DAYS = 90


def get_batch_expiry_date(batch_no: str):
	"""Resolve Batch.expiry_date by name or batch_id."""
	if not batch_no:
		return None

	expiry = frappe.db.get_value("Batch", batch_no, "expiry_date")
	if expiry:
		return getdate(expiry)

	# Some POS clients send Batch.batch_id instead of Batch.name
	row = frappe.db.get_value(
		"Batch",
		{"batch_id": batch_no},
		["name", "expiry_date"],
		as_dict=True,
	)
	if row and row.expiry_date:
		return getdate(row.expiry_date)
	return None


def get_item_end_of_life(item_code: str):
	if not item_code:
		return None
	eol = frappe.db.get_value("Item", item_code, "end_of_life")
	return getdate(eol) if eol else None


def _line_item_code(item: dict) -> str:
	return (item.get("id") or item.get("item_code") or item.get("itemCode") or "").strip()


def _line_batch_no(item: dict) -> str:
	return (
		item.get("batchNumber")
		or item.get("batch_no")
		or item.get("batch_id")
		or item.get("batchId")
		or ""
	).strip()


def validate_pos_items_batch_expiry(items, *, allow_near_expiry: bool = True):
	"""
	Block expired Item end_of_life / Batch expiry on POS dispense & checkout.

	Near-expiry is not blocked here (frontend warns); expired always throws.
	"""
	if not items:
		return

	today_date = getdate(today())
	expired_msgs = []

	for item in items:
		item_code = _line_item_code(item)
		if not item_code:
			continue

		item_name = item.get("name") or item.get("item_name") or item_code
		eol = get_item_end_of_life(item_code)
		if eol and eol < today_date:
			expired_msgs.append(
				_("Item {0} reached end of life on {1}").format(item_name, frappe.format(eol, {"fieldtype": "Date"}))
			)

		batch_no = _line_batch_no(item)
		if not batch_no:
			continue

		expiry = get_batch_expiry_date(batch_no)
		if expiry and expiry < today_date:
			expired_msgs.append(
				_("Batch {0} for {1} expired on {2}").format(
					batch_no,
					item_name,
					frappe.format(expiry, {"fieldtype": "Date"}),
				)
			)

	if expired_msgs:
		frappe.throw(
			_("Cannot dispense / sell expired stock:\n{0}").format("\n".join(f"• {m}" for m in expired_msgs)),
			title=_("Expired medicine"),
		)

	# allow_near_expiry kept for API clarity / future hard-block setting
	_ = allow_near_expiry


def get_near_expiry_batch_warnings(items, days: int = NEAR_EXPIRY_DAYS):
	"""Return list of warning strings for batches expiring within `days` (not yet expired)."""
	if not items:
		return []

	today_date = getdate(today())
	cutoff = add_days(today_date, days)
	warnings = []

	for item in items:
		item_code = _line_item_code(item)
		batch_no = _line_batch_no(item)
		if not item_code or not batch_no:
			continue

		expiry = get_batch_expiry_date(batch_no)
		if not expiry:
			continue
		if today_date <= expiry <= cutoff:
			item_name = item.get("name") or item.get("item_name") or item_code
			warnings.append(
				_("Batch {0} for {1} expires on {2}").format(
					batch_no,
					item_name,
					frappe.format(expiry, {"fieldtype": "Date"}),
				)
			)

	return warnings
