# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

# import frappe
from frappe import _

import frappe
from frappe.utils import flt

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
	conditions = ""

	if filters.get("company"):
		conditions += " AND si.company = %(company)s"

	if filters.get("start_date"):
		conditions += " AND si.posting_date >= %(start_date)s"

	if filters.get("end_date"):
		conditions += " AND si.posting_date <= %(end_date)s"

	if filters.get("health_insurance"):
		conditions += " AND si.health_insurance = %(health_insurance)s"

	invoices = frappe.db.sql(f"""
		SELECT
			si.name,
			si.posting_date,
			si.grand_total,
			si.custom_amount_to_be_covered,
			si.company,
			sii.item_code,
			sii.rate,
			sii.discount_amount,
			sii.batch_no
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
		WHERE si.docstatus = 1
		{conditions}
	""", filters, as_dict=True)

	data = []

	for row in invoices:
		percentage = 0
		original_price = 0

		if row.grand_total:
			percentage = ((flt(row.custom_amount_to_be_covered) / flt(row.grand_total)) * 100) if row.custom_amount_to_be_covered else 100

		if row.rate:
			original_price = row.rate * (percentage / 100)

		# Fetch barcode from Batch
		barcode = ""
		if row.batch_no:
			barcode = frappe.db.get_value(
				"Item Barcode",
				{
					"parent": row.item_code,
					"custom_batch": row.batch_no
				},
				"barcode"
			)
		discounted_price = None

		if row.discount_amount and row.discount_amount > 0:
			discounted_price = row.rate - row.discount_amount
		else:
			discounted_price = row.rate
   
		data.append({
			"item_code": row.item_code,
			"barcode": barcode,
			"reason": "Insurance Coverage",  # static unless you have field
			"start_date": row.posting_date,
			"end_date": row.posting_date,
			"campaign_status": "Completed",
			"discounted_price": discounted_price,
			"original_price": original_price,
			"active": 1
		})

	return data