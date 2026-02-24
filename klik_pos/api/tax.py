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


@frappe.whitelist(allow_guest=True)
def get_free_item_tax_amount(items):
	"""
	Return total tax amount for a list of free items (item_code, qty, optional uom).
	Used by the frontend to include tax on free items in the grand total.
	Uses the same logic as Sales Invoice free-item tax:
	- Item/Item Group default Item Tax Template
	- UOM-aware base rate (price for that UOM or derived via conversion factor)
	- Then template tax rate
	"""
	from frappe.utils import flt

	try:
		if not items:
			return {"success": True, "total_tax": 0.0}
		if isinstance(items, str):
			items = frappe.parse_json(items)
		items = [x for x in items if x.get("item_code") and flt(x.get("qty"), 0) > 0]
		if not items:
			return {"success": True, "total_tax": 0.0}

		company = frappe.defaults.get_user_default("Company")
		if not company:
			return {"success": True, "total_tax": 0.0}

		pos = get_current_pos_profile()
		price_list = getattr(pos, "selling_price_list", None) or None

		total_tax = 0.0
		for row in items:
			item_code = row.get("item_code")
			qty = flt(row.get("qty"), 0)
			item_uom = row.get("uom")
			if not item_code or qty <= 0:
				continue

			res = get_item_tax_template_for_item(item_code, company)
			template = res.get("item_tax_template") if res else None
			if not template:
				continue

			rate_res = get_item_tax_template_rate(template)
			tax_rate = flt(rate_res.get("rate"), 0) if rate_res else 0
			if tax_rate <= 0:
				continue

			# --- UOM-aware base rate, mirroring Sales Invoice free-item logic ---
			base_rate = 0.0
			try:
				stock_uom, standard_rate = frappe.db.get_value(
					"Item", item_code, ["stock_uom", "standard_rate"]
				) or (None, 0)
			except Exception:
				stock_uom, standard_rate = (None, 0)

			standard_rate = flt(standard_rate or 0)

			try:
				# 1) Prefer Item Price for the requested UOM (if provided)
				if item_uom:
					item_price_filters = {
						"item_code": item_code,
						"selling": 1,
						"uom": item_uom,
					}
					if price_list:
						item_price_filters["price_list"] = price_list

					price_doc = frappe.get_value(
						"Item Price",
						item_price_filters,
						"price_list_rate",
					)

					if not price_doc and price_list:
						item_price_filters.pop("price_list", None)
						price_doc = frappe.get_value(
							"Item Price",
							item_price_filters,
							"price_list_rate",
						)

					if price_doc:
						base_rate = flt(price_doc or 0)

				# 2) If still no rate and UOM != stock_uom, derive from stock_uom via conversion factor
				if base_rate <= 0 and item_uom and stock_uom and item_uom != stock_uom:
					conv = frappe.db.get_value(
						"UOM Conversion Detail",
						{
							"parenttype": "Item",
							"parent": item_code,
							"uom": item_uom,
						},
						"conversion_factor",
					)
					conv = flt(conv or 0)
					if conv > 0:
						base_stock_rate = standard_rate
						if base_stock_rate <= 0 and price_list and stock_uom:
							stock_price = frappe.db.get_value(
								"Item Price",
								{
									"item_code": item_code,
									"price_list": price_list,
									"uom": stock_uom,
								},
								"price_list_rate",
							)
							base_stock_rate = flt(stock_price or 0)
						if base_stock_rate > 0:
							base_rate = base_stock_rate * conv

				# 3) Final fallback: standard_rate
				if base_rate <= 0 and standard_rate > 0:
					base_rate = standard_rate

				# 4) Last resort: any Item Price in POS price list (no UOM filter)
				if base_rate <= 0 and price_list:
					any_price = frappe.db.get_value(
						"Item Price",
						{"item_code": item_code, "price_list": price_list},
						"price_list_rate",
					)
					base_rate = flt(any_price or 0)
			except Exception:
				base_rate = flt(standard_rate or 0)

			if base_rate <= 0:
				continue

			total_tax += (base_rate * qty * tax_rate) / 100.0

		return {"success": True, "total_tax": round(float(total_tax), 3)}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "get_free_item_tax_amount")
		return {"success": False, "error": str(e), "total_tax": 0.0}
