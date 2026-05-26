# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

import frappe

from klik_pos.klik_pos.report.talabat.talabat_pricing import (
	fetch_talabat_lines,
	get_discounted_unit_net_rate,
	get_template_tax_rates,
	get_unit_price_including_vat,
)


def execute(filters=None):
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{"label": "SKU", "fieldname": "item_code", "fieldtype": "Data", "width": 150},
		{"label": "Barcode", "fieldname": "barcode", "fieldtype": "Data", "width": 150},
		{"label": "Reason", "fieldname": "reason", "fieldtype": "Data", "width": 150},
		{"label": "Start Date", "fieldname": "start_date", "fieldtype": "Date", "width": 120},
		{"label": "End Date", "fieldname": "end_date", "fieldtype": "Date", "width": 120},
		{"label": "Campaign Status", "fieldname": "campaign_status", "fieldtype": "Data", "width": 150},
		{"label": "Discounted Price", "fieldname": "discounted_price", "fieldtype": "Currency", "width": 120},
		{"label": "Original Price", "fieldname": "original_price", "fieldtype": "Currency", "width": 120},
		{"label": "Active", "fieldname": "active", "fieldtype": "Check", "width": 80},
	]


def get_data(filters):
	lines = fetch_talabat_lines(filters)
	template_tax_rates = get_template_tax_rates([row.item_tax_template for row in lines])

	data = []

	for row in lines:
		original_price = get_unit_price_including_vat(row, template_tax_rates)
		discounted_net = get_discounted_unit_net_rate(row)
		discounted_price = get_unit_price_including_vat(
			row, template_tax_rates, unit_net_rate=discounted_net
		)

		barcode = ""
		if row.batch_no:
			barcode = frappe.db.get_value(
				"Item Barcode",
				{
					"parent": row.item_code,
					"custom_batch": row.batch_no,
				},
				"barcode",
			)

		data.append({
			"item_code": row.item_code,
			"barcode": barcode,
			"reason": "Transport",
			"start_date": row.posting_date,
			"end_date": row.posting_date,
			"campaign_status": "Completed",
			"discounted_price": discounted_price,
			"original_price": original_price,
			"active": 1,
		})

	return data
