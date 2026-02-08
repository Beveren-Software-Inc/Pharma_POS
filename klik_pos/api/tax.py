import frappe
from frappe import _

from klik_pos.klik_pos.utils import get_current_pos_profile


@frappe.whitelist(allow_guest=True)
def get_sales_tax_categories():
	try:
		tax_categories = frappe.get_all(
			"Sales Taxes and Charges Template",
			filters={"disabled": 0},
			fields=["name", "title"],
		)

		result = []
		for cat in tax_categories:
			# Get the first tax entry to determine rate and type
			tax_entry = frappe.db.get_value(
				"Sales Taxes and Charges",
				{"parent": cat.name},
				["rate", "included_in_print_rate"],
				as_dict=True,
			)

			tax_rate = tax_entry.get("rate", 0.0) if tax_entry else 0.0
			is_inclusive = tax_entry.get("included_in_print_rate", 0) if tax_entry else 0

			result.append(
				{
					"id": cat.name,
					"name": cat.title or cat.name,
					"rate": float(tax_rate),
					"is_inclusive": bool(is_inclusive),
					"type": "inclusive" if is_inclusive else "exclusive",
				}
			)

		default_template = None
		try:
			pos_doc = get_current_pos_profile()
			default_template = pos_doc.taxes_and_charges
		except Exception:
			pass

		return {"success": True, "data": result, "default": default_template}
	except Exception as e:
		frappe.log_error("Tax Fetch Failed", str(e))
		return {"success": False, "error": str(e)}


def get_default_sales_tax_charges():
	pos_doc = get_current_pos_profile()
	return pos_doc.taxes_and_charges


@frappe.whitelist(allow_guest=True)
def get_item_tax_template_for_item(item_code, company=None):
	"""Get the default item tax template for an item (from Item.taxes or Item Group hierarchy)."""
	try:
		if not item_code:
			return {"success": True, "item_tax_template": None}

		company = company or frappe.defaults.get_user_default("Company")
		if not company:
			return {"success": True, "item_tax_template": None}

		item = frappe.get_cached_doc("Item", item_code)
		item_tax_template = None

		if item.get("taxes"):
			for tax in item.taxes:
				if tax.item_tax_template:
					template_company = frappe.db.get_value("Item Tax Template", tax.item_tax_template, "company")
					if template_company == company:
						item_tax_template = tax.item_tax_template
						break

		if not item_tax_template and item.item_group:
			item_group = item.item_group
			while item_group:
				ig_doc = frappe.get_cached_doc("Item Group", item_group)
				if ig_doc.get("taxes"):
					for tax in ig_doc.taxes:
						if tax.item_tax_template:
							template_company = frappe.db.get_value("Item Tax Template", tax.item_tax_template, "company")
							if template_company == company:
								item_tax_template = tax.item_tax_template
								break
				if item_tax_template:
					break
				item_group = ig_doc.parent_item_group if ig_doc.parent_item_group else None

		return {"success": True, "item_tax_template": item_tax_template}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "get_item_tax_template_for_item")
		return {"success": False, "error": str(e), "item_tax_template": None}


@frappe.whitelist(allow_guest=True)
def get_item_tax_templates(company=None):
	"""List Item Tax Templates for the company (for cart dropdown)."""
	try:
		company = company or frappe.defaults.get_user_default("Company")
		if not company:
			return {"success": True, "data": []}

		templates = frappe.get_all(
			"Item Tax Template",
			filters={"company": company, "disabled": 0},
			fields=["name", "title"],
			order_by="title asc",
		)
		return {"success": True, "data": [{"id": t.name, "name": t.title or t.name} for t in templates]}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "get_item_tax_templates")
		return {"success": False, "error": str(e), "data": []}


@frappe.whitelist(allow_guest=True)
def get_item_tax_template_rate(item_tax_template):
	"""Get effective tax rate (sum of all tax rates) for an Item Tax Template. Returns 0 if None/empty."""
	try:
		if not item_tax_template:
			return {"success": True, "rate": 0.0}

		details = frappe.get_all(
			"Item Tax Template Detail",
			filters={"parent": item_tax_template},
			fields=["tax_rate"],
		)
		total_rate = sum(float(d.tax_rate or 0) for d in details)
		return {"success": True, "rate": total_rate}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "get_item_tax_template_rate")
		return {"success": False, "error": str(e), "rate": 0.0}


@frappe.whitelist(allow_guest=True)
def get_item_tax_template_rates(templates):
	"""Get effective tax rates for multiple Item Tax Templates. Returns dict template_name -> rate."""
	try:
		if not templates:
			return {"success": True, "rates": {}}
		if isinstance(templates, str):
			templates = frappe.parse_json(templates) if templates.startswith("[") else [templates]
		templates = [t for t in templates if t]
		if not templates:
			return {"success": True, "rates": {}}

		placeholders = ", ".join(["%s"] * len(templates))
		rows = frappe.db.sql(
			f"""
			SELECT parent, SUM(tax_rate) as total_rate
			FROM `tabItem Tax Template Detail`
			WHERE parent IN ({placeholders})
			GROUP BY parent
			""",
			templates,
			as_dict=True,
		)
		rates = {r["parent"]: float(r["total_rate"] or 0) for r in rows}
		for t in templates:
			if t not in rates:
				rates[t] = 0.0
		return {"success": True, "rates": rates}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "get_item_tax_template_rates")
		return {"success": False, "error": str(e), "rates": {}}
