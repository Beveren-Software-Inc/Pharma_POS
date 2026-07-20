# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, getdate


def execute(filters: dict | None = None):
	filters = frappe._dict(filters or {})
	columns = get_columns(filters)
	data = get_data(filters)
	chart = get_chart_data(data, filters)
	message = get_message()
	return columns, data, message, chart


def get_columns(filters: dict) -> list[dict]:
	if filters.get("group_by") == "Invoice":
		return [
			{
				"label": _("Invoice"),
				"fieldname": "invoice",
				"fieldtype": "Link",
				"options": "Sales Invoice",
				"width": 140,
			},
			{
				"label": _("Posting Date"),
				"fieldname": "posting_date",
				"fieldtype": "Date",
				"width": 110,
			},
			{
				"label": _("Delivery Personnel"),
				"fieldname": "delivery_personnel",
				"fieldtype": "Link",
				"options": "Delivery Personnel",
				"width": 160,
			},
			{
				"label": _("Delivery Personnel Name"),
				"fieldname": "delivery_personnel_name",
				"fieldtype": "Data",
				"width": 180,
			},
			{
				"label": _("Status"),
				"fieldname": "status",
				"fieldtype": "Data",
				"width": 100,
			},
			{
				"label": _("Invoice Amount"),
				"fieldname": "invoice_amount",
				"fieldtype": "Currency",
				"width": 130,
			},
			{
				"label": _("Delivery Charges"),
				"fieldname": "delivery_charges",
				"fieldtype": "Currency",
				"width": 140,
			},
			{
				"label": _("Payment %"),
				"fieldname": "payment_percentage",
				"fieldtype": "Percent",
				"width": 100,
			},
			{
				"label": _("Amount Payable"),
				"fieldname": "amount_payable",
				"fieldtype": "Currency",
				"width": 140,
			},
		]

	return [
		{
			"label": _("Delivery Personnel"),
			"fieldname": "delivery_personnel",
			"fieldtype": "Link",
			"options": "Delivery Personnel",
			"width": 160,
		},
		{
			"label": _("Delivery Personnel Name"),
			"fieldname": "delivery_personnel_name",
			"fieldtype": "Data",
			"width": 180,
		},
		{
			"label": _("Total Deliveries"),
			"fieldname": "total_deliveries",
			"fieldtype": "Int",
			"width": 130,
		},
		{
			"label": _("Invoice Amount"),
			"fieldname": "invoice_amount",
			"fieldtype": "Currency",
			"width": 140,
		},
		{
			"label": _("Delivery Charges"),
			"fieldname": "delivery_charges",
			"fieldtype": "Currency",
			"width": 140,
		},
		{
			"label": _("Payment %"),
			"fieldname": "payment_percentage",
			"fieldtype": "Percent",
			"width": 100,
		},
		{
			"label": _("Amount Payable"),
			"fieldname": "amount_payable",
			"fieldtype": "Currency",
			"width": 140,
		},
	]


def get_message() -> str:
	default_pct = flt(frappe.db.get_single_value("Delivery Charges", "payment_percentage") or 0)
	return _(
		"Amount Payable = Delivery Charges × Payment %. "
		"Uses the delivery person's Payment % when set; otherwise falls back to Delivery Charges ({0}%)."
	).format(default_pct)


def get_data(filters: dict) -> list[dict]:
	invoices = fetch_invoices(filters)
	if not invoices:
		return []

	default_pct = flt(frappe.db.get_single_value("Delivery Charges", "payment_percentage") or 0)
	standard_charges = flt(
		frappe.db.get_single_value("Delivery Charges", "standard_delivery_charges") or 0
	)
	delivery_item = get_delivery_charge_item_code()
	charge_map = get_delivery_charge_amounts([row.name for row in invoices], delivery_item)
	personnel_pct_map = get_personnel_payment_percentages(
		{row.custom_delivery_personnel for row in invoices if row.custom_delivery_personnel}
	)

	detail_rows = []
	for inv in invoices:
		delivery_charges = flt(charge_map.get(inv.name) or 0)
		if delivery_charges <= 0:
			delivery_charges = standard_charges

		personnel = inv.custom_delivery_personnel
		personnel_pct = flt(personnel_pct_map.get(personnel) or 0)
		payment_percentage = personnel_pct if personnel_pct > 0 else default_pct
		amount_payable = flt(delivery_charges * payment_percentage / 100.0, 2)

		detail_rows.append(
			{
				"invoice": inv.name,
				"posting_date": inv.posting_date,
				"delivery_personnel": personnel,
				"delivery_personnel_name": inv.custom_delivery_personnel_name
				or inv.personnel_display_name
				or personnel,
				"status": inv.status,
				"invoice_amount": flt(inv.grand_total),
				"delivery_charges": flt(delivery_charges, 2),
				"payment_percentage": payment_percentage,
				"amount_payable": amount_payable,
			}
		)

	if filters.get("group_by") == "Invoice":
		detail_rows.sort(key=lambda r: (r["delivery_personnel_name"] or "", r["posting_date"] or getdate()))
		return detail_rows

	return aggregate_by_personnel(detail_rows)


def aggregate_by_personnel(detail_rows: list[dict]) -> list[dict]:
	grouped: dict[str, dict] = {}

	for row in detail_rows:
		key = row["delivery_personnel"]
		if key not in grouped:
			grouped[key] = {
				"delivery_personnel": key,
				"delivery_personnel_name": row["delivery_personnel_name"],
				"total_deliveries": 0,
				"invoice_amount": 0.0,
				"delivery_charges": 0.0,
				"payment_percentage": row["payment_percentage"],
				"amount_payable": 0.0,
			}

		bucket = grouped[key]
		bucket["total_deliveries"] += 1
		bucket["invoice_amount"] = flt(bucket["invoice_amount"] + row["invoice_amount"], 2)
		bucket["delivery_charges"] = flt(bucket["delivery_charges"] + row["delivery_charges"], 2)
		bucket["amount_payable"] = flt(bucket["amount_payable"] + row["amount_payable"], 2)
		# Keep the latest non-zero % seen for display (usually same per person)
		if row["payment_percentage"]:
			bucket["payment_percentage"] = row["payment_percentage"]

	rows = list(grouped.values())
	rows.sort(key=lambda r: r["total_deliveries"], reverse=True)
	return rows


def fetch_invoices(filters: dict) -> list[dict]:
	conditions = [
		"si.docstatus = 1",
		"si.custom_delivery_personnel IS NOT NULL",
		"si.custom_delivery_personnel != ''",
	]
	values = {}

	if filters.get("from_date"):
		conditions.append("si.posting_date >= %(from_date)s")
		values["from_date"] = filters.from_date

	if filters.get("to_date"):
		conditions.append("si.posting_date <= %(to_date)s")
		values["to_date"] = filters.to_date

	if filters.get("delivery_personnel"):
		conditions.append("si.custom_delivery_personnel = %(delivery_personnel)s")
		values["delivery_personnel"] = filters.delivery_personnel

	if filters.get("company"):
		conditions.append("si.company = %(company)s")
		values["company"] = filters.company

	where_clause = " AND ".join(conditions)

	return frappe.db.sql(
		f"""
		SELECT
			si.name,
			si.posting_date,
			si.grand_total,
			si.status,
			si.custom_delivery_personnel,
			si.custom_delivery_personnel_name,
			dp.delivery_personnel AS personnel_display_name
		FROM `tabSales Invoice` si
		LEFT JOIN `tabDelivery Personnel` dp
			ON dp.name = si.custom_delivery_personnel
		WHERE {where_clause}
		ORDER BY si.posting_date DESC, si.name DESC
		""",
		values,
		as_dict=True,
	)


def get_delivery_charge_item_code() -> str | None:
	try:
		from klik_pos.api.delivery_charges import _ensure_delivery_charge_item

		return _ensure_delivery_charge_item()
	except Exception:
		return "Delivery Charge"


def get_delivery_charge_amounts(invoice_names: list[str], item_code: str | None) -> dict[str, float]:
	if not invoice_names or not item_code:
		return {}

	rows = frappe.db.sql(
		"""
		SELECT parent, SUM(amount) AS total_amount
		FROM `tabSales Invoice Item`
		WHERE parent IN %(parents)s
			AND item_code = %(item_code)s
		GROUP BY parent
		""",
		{"parents": invoice_names, "item_code": item_code},
		as_dict=True,
	)
	return {row.parent: flt(row.total_amount) for row in rows}


def get_personnel_payment_percentages(personnel_names: set[str]) -> dict[str, float]:
	if not personnel_names:
		return {}

	rows = frappe.db.get_all(
		"Delivery Personnel",
		filters={"name": ("in", list(personnel_names))},
		fields=["name", "payment_percentage"],
	)
	return {row.name: flt(row.payment_percentage) for row in rows}


def get_chart_data(data: list[dict], filters: dict) -> dict | None:
	if not data:
		return None

	if filters.get("group_by") == "Invoice":
		# Aggregate for chart even in detail view
		summary = aggregate_by_personnel(data)
	else:
		summary = data

	labels = [row.get("delivery_personnel_name") or row.get("delivery_personnel") for row in summary]
	payable = [flt(row.get("amount_payable")) for row in summary]
	deliveries = [flt(row.get("total_deliveries") or 0) for row in summary]

	return {
		"data": {
			"labels": labels,
			"datasets": [
				{"name": _("Amount Payable"), "values": payable},
				{"name": _("Total Deliveries"), "values": deliveries},
			],
		},
		"type": "bar",
		"colors": ["#2563eb", "#94a3b8"],
		"barOptions": {"stacked": 0},
	}
