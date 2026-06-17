# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.utils import flt


def fetch_talabat_lines(filters, conditions_extra=""):
	filters = filters or {}
	conditions = " AND si.custom_delivery_via = 'Talabat'" + conditions_extra

	if filters.get("company"):
		conditions += " AND si.company = %(company)s"

	if filters.get("start_date"):
		conditions += " AND si.posting_date >= %(start_date)s"

	if filters.get("end_date"):
		conditions += " AND si.posting_date <= %(end_date)s"

	return frappe.db.sql(
		f"""
		SELECT
			si.name AS invoice,
			si.posting_date,
			sii.name AS item_row,
			sii.item_code,
			sii.qty,
			sii.rate,
			sii.net_rate,
			sii.amount,
			sii.net_amount,
			sii.discount_amount,
			sii.item_tax_template,
			sii.item_tax_rate,
			sii.batch_no
		FROM `tabSales Invoice` si
		INNER JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
		WHERE si.docstatus = 1
		{conditions}
		""",
		filters,
		as_dict=True,
	)


def get_template_tax_rates(template_names):
	"""Sum tax_rate from Item Tax Template child rows (exclusive VAT on net)."""
	template_names = [name for name in set(template_names or []) if name]
	if not template_names:
		return {}

	rows = frappe.db.sql(
		"""
		SELECT parent, SUM(tax_rate) AS total_tax_rate
		FROM `tabItem Tax Template Detail`
		WHERE parent IN %(templates)s
			AND IFNULL(not_applicable, 0) = 0
		GROUP BY parent
		""",
		{"templates": template_names},
		as_dict=True,
	)
	return {row.parent: flt(row.total_tax_rate) for row in rows}


def _sum_item_tax_rates(item_tax_rate):
	"""Fallback when item_tax_template is empty but item_tax_rate JSON is set."""
	if not item_tax_rate:
		return 0.0
	try:
		tax_map = json.loads(item_tax_rate) if isinstance(item_tax_rate, str) else item_tax_rate
	except (TypeError, ValueError):
		return 0.0
	if not isinstance(tax_map, dict):
		return 0.0

	total = 0.0
	for rate in tax_map.values():
		if rate in (None, "NA"):
			continue
		total += flt(rate)
	return total


def _tax_rate_for_row(row, template_tax_rates):
	if row.item_tax_template:
		return flt(template_tax_rates.get(row.item_tax_template))
	return _sum_item_tax_rates(row.item_tax_rate)


def _unit_net_rate(row, qty):
	unit_net = flt(row.net_rate)
	if unit_net:
		return unit_net

	net_amount = flt(row.net_amount)
	if net_amount and qty:
		return net_amount / qty

	amount = flt(row.amount)
	if amount and qty:
		return amount / qty

	return flt(row.rate)


def get_unit_price_including_vat(row, template_tax_rates, unit_net_rate=None):
	"""Unit price including VAT from Item Tax Template rates (exclusive net + tax)."""
	unit_net = _unit_net_rate(row, flt(row.qty) or 1) if unit_net_rate is None else flt(unit_net_rate)
	tax_rate = _tax_rate_for_row(row, template_tax_rates)

	if tax_rate and unit_net:
		return flt(unit_net * (1 + tax_rate / 100))

	return flt(row.rate) or unit_net


def get_discounted_unit_net_rate(row):
	if flt(row.discount_amount) > 0:
		return flt(row.rate) - flt(row.discount_amount)
	return _unit_net_rate(row, flt(row.qty) or 1)
