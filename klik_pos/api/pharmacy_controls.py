# Copyright (c) 2026, Klik POS contributors
"""Serene BRD pharmacy controls.

PHA-036  A controlled ("pink prescription") medicine may not be issued without a
         prescription reference.
PHA-039 / PHA-055  Every hospital-pharmacy issue must be linked to a patient.
PHA-054  Discount overrides record who authorised them.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

# Item Groups flagged as controlled carry custom_is_pink on the group.
PINK_CACHE_KEY = "serene_pink_item_groups"


def _setting(field: str) -> int:
	return int(frappe.db.get_single_value("Healthcare Settings", field) or 0)


def _pink_item_groups() -> set[str]:
	groups = frappe.cache().get_value(PINK_CACHE_KEY)
	if groups is None:
		groups = frappe.get_all(
			"Item Group", filters={"custom_is_pink": 1}, pluck="name"
		)
		frappe.cache().set_value(PINK_CACHE_KEY, groups, expires_in_sec=600)
	return set(groups or [])


def _is_pharmacy_pos(doc) -> bool:
	if not doc.get("is_pos") or not doc.get("pos_profile"):
		return False
	return bool(
		frappe.db.get_value("POS Profile", doc.pos_profile, "custom_is_pharmacy")
	)


def validate_pharmacy_issue(doc, method=None) -> None:
	"""Sales Invoice `validate` hook for pharmacy POS sales."""
	if doc.get("is_return") or not _is_pharmacy_pos(doc):
		return

	# ---------------------------------------------------- PHA-039 / PHA-055
	if _setting("require_patient_on_pharmacy_sale") and not doc.get("patient"):
		is_hospital = frappe.db.get_value(
			"POS Profile", doc.pos_profile, "custom_is_hospital_pharmacy"
		)
		if is_hospital:
			frappe.throw(
				_(
					"A patient must be selected for a hospital pharmacy issue so the "
					"medicine is traceable to the patient record."
				),
				title=_("Patient required"),
			)

	# ---------------------------------------------------- PHA-036
	if not _setting("require_prescription_for_controlled_items"):
		return

	pink_groups = _pink_item_groups()
	if not pink_groups:
		return

	offending = []
	for item in doc.get("items") or []:
		group = frappe.get_cached_value("Item", item.item_code, "item_group")
		if group in pink_groups:
			offending.append(f"{item.item_code} ({group})")

	if not offending:
		return

	if doc.get("custom_prescription_reference") or doc.get("patient"):
		return

	frappe.throw(
		_(
			"Controlled (pink prescription) medicines cannot be issued without a "
			"prescription: {0}. Record the patient or the prescription reference first."
		).format(", ".join(offending[:5])),
		title=_("Prescription required"),
	)


def stamp_discount_authoriser(doc, method=None) -> None:
	"""PHA-054 - record who authorised a discount override."""
	if not doc.meta.has_field("custom_discount_authorised_by"):
		return
	if not _is_pharmacy_pos(doc):
		return

	discounted = flt(doc.get("discount_amount")) or flt(
		doc.get("additional_discount_percentage")
	)
	if not discounted:
		return

	if not doc.get("custom_discount_authorised_by"):
		doc.custom_discount_authorised_by = frappe.session.user
	if not doc.get("custom_discount_authorised_on"):
		doc.custom_discount_authorised_on = frappe.utils.now_datetime()


def clear_pink_cache(doc=None, method=None) -> None:
	frappe.cache().delete_value(PINK_CACHE_KEY)
