import frappe
from frappe.utils import flt


@frappe.whitelist()
def get_delivery_fee(distance, company=None, grand_total=None):
	"""Return the configured delivery fee for a given distance in km.

	Bands are defined in the single doctype "Delivery Charges" via the child table
	"Delivery Charges Detail" with fields:
	- distance_threshold (km)
	- amount (Amount Threshold): if grand_total >= amount, delivery is free for this band
	- delivery_fee (fee to apply when grand_total < amount)

	Logic:
	1. Find the row by distance (bands sorted by distance_threshold ascending):
	   - distance < first_threshold -> 0 fee
	   - first_threshold <= distance <= row[i].distance_threshold -> use row i
	   - distance > last threshold -> requires_manual
	2. For the matched row, if amount threshold is set and grand_total is provided:
	   - If grand_total >= amount_threshold -> free delivery (fee 0)
	   - Else -> charge delivery_fee from that row
	"""

	distance = flt(distance or 0)
	if distance <= 0:
		return {"success": True, "fee": 0.0, "requires_manual": False}

	grand_total = flt(grand_total) if grand_total is not None else None

	try:
		doc = frappe.get_single("Delivery Charges")
	except Exception:
		return {
			"success": False,
			"fee": 0.0,
			"requires_manual": True,
			"error": "Delivery Charges configuration not found.",
		}
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

	def _fee_for_row(row, order_total):
		"""Apply amount threshold: if order_total >= row.amount, free delivery; else delivery_fee."""
		fee = flt(getattr(row, "delivery_fee", 0) or 0)
		amount_threshold = flt(getattr(row, "amount", 0) or 0)

		if order_total is not None and amount_threshold > 0 and order_total >= amount_threshold:
			return 0.0
		return fee

	first_threshold = flt(getattr(rows[0], "distance_threshold", 0) or 0)

	if distance < first_threshold:
		return {"success": True, "fee": 0.0, "requires_manual": False}

	if distance == first_threshold:
		fee = _fee_for_row(rows[0], grand_total)
		return {"success": True, "fee": fee, "requires_manual": False}

	prev_threshold = first_threshold
	
	for row in rows[1:]:
		current_threshold = flt(getattr(row, "distance_threshold", 0) or 0)
		if prev_threshold < distance <= current_threshold:
			fee = _fee_for_row(row, grand_total)
			print("The fee is like", grand_total)
			return {"success": True, "fee": fee, "requires_manual": False}
		prev_threshold = current_threshold

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

	amount = flt(amount or 0)
	print(f"Calculating tax for delivery charge amount: {amount}")

	if amount <= 0:
		return {"success": True, "tax": 0.0}

	item_code = _ensure_delivery_charge_item()

	item_tax_rows = frappe.get_all(
		"Item Tax",
		filters={"parent": item_code},
		fields=["item_tax_template"]
	)

	print(f"Found {len(item_tax_rows)} tax template rows for item {item_code}")

	if not item_tax_rows:
		return {"success": True, "tax": 0.0}

	total_rate = 0.0

	for row in item_tax_rows:
		if not row.item_tax_template:
			continue

		template_taxes = frappe.get_all(
			"Item Tax Template Detail",
			filters={"parent": row.item_tax_template},
			fields=["tax_rate"]
		)

		for tax in template_taxes:
			total_rate += flt(tax.tax_rate or 0)

	if total_rate <= 0:
		return {"success": True, "tax": 0.0}

	tax_amount = amount * total_rate / 100.0

	return {
		"success": True,
		"tax": round(float(tax_amount), 3)
	}