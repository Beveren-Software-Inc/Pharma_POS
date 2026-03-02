import frappe
from frappe.utils import flt


@frappe.whitelist()
def get_delivery_fee(distance, company=None):
	"""Return the configured delivery fee for a given distance in km.

	Bands are defined in the single doctype "Delivery Charges" via the child table
	"Delivery Charges Detail" with fields:
	- distance_threshold (km)
	- amount_threshold (reserved for future use)
	- fee_charges (fee to apply)

	Logic (distance bands):
	- Rows are sorted by distance_threshold ascending.
	- For the first row (e.g. 3 km):
	  * distance < 3       -> 0 fee
	  * distance == 3      -> fee_charges of that row
	- For each subsequent row i with threshold T_i and previous T_{i-1}:
	  * T_{i-1} < distance <= T_i -> fee_charges of row i
	- If distance is greater than the last threshold:
	  * No automatic fee; cashier must enter manually.
	"""

	distance = flt(distance or 0)
	if distance <= 0:
		return {"success": True, "fee": 0.0, "requires_manual": False}

	company = company or frappe.defaults.get_user_default("Company")

	filters = {}
	if company:
		filters["company"] = company

	name = frappe.db.get_value("Delivery Charges", filters, "name")
	if not name:
		return {
			"success": False,
			"fee": 0.0,
			"requires_manual": True,
			"error": "Delivery Charges configuration not found.",
		}

	doc = frappe.get_doc("Delivery Charges", name)
	if not getattr(doc, "delivery_fees", None):
		return {
			"success": False,
			"fee": 0.0,
			"requires_manual": True,
			"error": "No delivery fee bands configured.",
		}

	rows = sorted(doc.delivery_fees, key=lambda r: flt(getattr(r, "distance_threshold", 0)))
	if not rows:
		return {
			"success": False,
			"fee": 0.0,
			"requires_manual": True,
			"error": "No delivery fee bands configured.",
		}

	def _fee_for_row(row):
		return flt(getattr(row, "delivery_fee", 0) or 0)

	first_threshold = flt(getattr(rows[0], "distance_threshold", 0) or 0)

	# Anything below the first threshold: no charge
	if distance < first_threshold:
		return {"success": True, "fee": 0.0, "requires_manual": False}

	# Exactly at the first threshold: apply its fee
	if distance == first_threshold:
		return {"success": True, "fee": _fee_for_row(rows[0]), "requires_manual": False}
	
	prev_threshold = first_threshold
	for row in rows[1:]:
		current_threshold = flt(getattr(row, "distance_threshold", 0) or 0)
		print(f"Checking distance {distance} against thresholds {prev_threshold} and {current_threshold}")
		if prev_threshold < distance <= current_threshold:
			print("here its working",row.distance_threshold,row.delivery_fee)
			return {"success": True, "fee": _fee_for_row(row), "requires_manual": False}
		prev_threshold = current_threshold

	# Above last threshold: manual entry required
	return {"success": True, "fee": 0.0, "requires_manual": True}


def _ensure_delivery_charge_item():
	"""Ensure an Item 'Delivery Charge' exists; create it if missing."""

	item_code = frappe.db.get_value(
		"Item",
		{"item_name": "Delivery Charge", "disabled": 0},
		"name",
	) or frappe.db.get_value(
		"Item",
		{"item_code": "Delivery Charge", "disabled": 0},
		"name",
	)

	if item_code:
		return item_code

	# Pick a reasonable Item Group
	item_group = frappe.db.get_value("Item Group", {"item_group_name": "Services"}, "name")
	if not item_group:
		item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"

	item = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": "Delivery Charge",
			"item_name": "Delivery Charge",
			"item_group": item_group,
			"is_stock_item": 0,
			"include_item_in_manufacturing": 0,
			"has_batch_no": 0,
			"has_serial_no": 0,
			"is_sales_item": 1,
		}
	)
	item.insert(ignore_permissions=True)
	return item.name


@frappe.whitelist()
def get_delivery_charge_tax_amount(amount, company=None):
	"""Calculate tax on the given delivery charge amount using the Delivery Charge item's Item Tax Template.

	This mirrors how ERPNext will tax the Delivery Charge line:
	- Find (or create) the Delivery Charge item.
	- Read its item_tax_template.
	- Sum all tax_rate values on that template.
	- Tax amount = amount * total_rate / 100.
	"""

	amount = flt(amount or 0)
	if amount <= 0:
		return {"success": True, "tax": 0.0}

	company = company or frappe.defaults.get_user_default("Company")

	item_code = _ensure_delivery_charge_item()

	# Direct item_tax_template on Item
	item_tax_template = frappe.db.get_value("Item", item_code, "item_tax_template")
	if not item_tax_template:
		# No template means no item-specific tax; rely on general POS template instead
		return {"success": True, "tax": 0.0}

	try:
		template_doc = frappe.get_doc("Item Tax Template", item_tax_template)
	except Exception:
		return {"success": False, "tax": 0.0, "error": "Item Tax Template not found for Delivery Charge item."}

	total_rate = 0.0
	for row in getattr(template_doc, "taxes", []):
		# Optional: filter by company if template is multi-company; most setups just use one company-wide rate
		if company and getattr(row, "company", None) and row.company != company:
			continue
		total_rate += flt(getattr(row, "tax_rate", 0) or 0)

	if total_rate <= 0:
		return {"success": True, "tax": 0.0}

	tax_amount = amount * total_rate / 100.0
	return {"success": True, "tax": round(float(tax_amount), 3)}

