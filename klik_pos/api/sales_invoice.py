import json

import erpnext
import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice
from frappe import _
from frappe.utils import flt, cint
from datetime import datetime, timedelta, date as date_type

from klik_pos.klik_pos.utils import get_current_pos_profile

# Performance optimization: Cache frequently accessed data
_cached_company_data = {}
_cached_customer_data = {}
_cached_item_accounts = {}


def get_current_pos_opening_entry():
	"""
	Get the latest active POS Opening Entry for the current user across ALL profiles.
	Returns the opening entry name or None if not found.
	"""
	try:
		user = frappe.session.user
		opening_entries = frappe.get_all(
			"POS Opening Entry",
			filters={"user": user, "docstatus": 1, "status": "Open"},
			fields=["name"],
			order_by="creation desc",
			limit_page_length=1,
		)

		if opening_entries:
			return opening_entries[0].name
		return None
	except Exception as e:
		frappe.log_error(f"Error getting current POS opening entry: {e!s}")
		return None


@frappe.whitelist(allow_guest=True)
def get_sales_invoices(limit=100, start=0, search="", skip_opening_entry_filter=False, cashier_name=None):
	"""
	Get sales invoices with proper filtering based on user role and POS opening entry.

	Args:
		skip_opening_entry_filter: If True, skip filtering by opening entry (for Invoice History page)
		cashier_name: Filter by cashier name (full name). If provided, only returns invoices for that cashier.
	"""
	try:
		# Convert string to boolean if needed (Frappe passes query params as strings)
		if isinstance(skip_opening_entry_filter, str):
			skip_opening_entry_filter = skip_opening_entry_filter.lower() in ("true", "1", "yes")

		# Get user IDs for cashier filter if cashier_name is provided
		cashier_user_ids = None
		if cashier_name and cashier_name != "all":
			cashier_user_ids = _get_user_ids_by_full_name(cashier_name)
			if not cashier_user_ids:
				# No users found with this name, return empty result
				return {"success": True, "data": [], "total_count": 0}

		filters, fields = _build_filters_and_fields(
			skip_opening_entry_filter=skip_opening_entry_filter, cashier_user_ids=cashier_user_ids
		)

		# Build search filters
		or_filters = _build_search_filters(search)

		invoices = frappe.get_all(
			"Sales Invoice",
			filters=filters,
			or_filters=or_filters,
			fields=fields,
			order_by="modified desc",
			limit=limit,
			start=start,
		)

		# Use Frappe's safe COUNT API instead of raw SQL string
		total_count = frappe.db.count("Sales Invoice", filters=filters, cache=False)

		# Batch fetch related data
		invoice_names = [inv.name for inv in invoices]
		user_ids = list(set([inv.owner for inv in invoices]))

		cashier_names_map = _batch_fetch_cashier_names(user_ids)
		payment_methods_map = _batch_fetch_payment_methods(invoice_names)
		items_map = _batch_fetch_items(invoice_names)

		# Process and enrich invoices
		_process_invoices(invoices, cashier_names_map, payment_methods_map, items_map)

		return {"success": True, "data": invoices, "total_count": total_count}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching sales invoices")
		return {"success": False, "error": str(e)}


def _get_user_ids_by_full_name(full_name):
	"""Get user IDs (emails) that match the given full name."""
	try:
		users = frappe.get_all(
			"User",
			filters={"full_name": full_name, "enabled": 1},
			fields=["name"],
		)
		return [user.name for user in users] if users else []
	except Exception as e:
		frappe.logger().error(f"Error getting user IDs by full name '{full_name}': {e}")
		return []


def _build_filters_and_fields(skip_opening_entry_filter=False, cashier_user_ids=None):
	"""Build filters and fields list based on user role and metadata.

	Args:
		skip_opening_entry_filter: If True, skip filtering by opening entry (show all invoices)
		cashier_user_ids: List of user IDs to filter by. If provided, only returns invoices for these users.
	"""
	current_opening_entry = get_current_pos_opening_entry()

	# Check if user is admin
	user_roles = frappe.get_roles()
	is_admin_user = "Administrator" in user_roles or "System Manager" in user_roles

	if skip_opening_entry_filter:
		frappe.logger().info(
			f"Skipping opening entry filter - showing all invoices for user {frappe.session.user}"
		)
		filters = {}
	elif is_admin_user:
		frappe.logger().info(
			f"Admin user {frappe.session.user} with roles {user_roles} - showing all POS invoices"
		)
		filters = {"custom_pos_opening_entry": ["!=", ""]}
	elif current_opening_entry:
		filters = {"custom_pos_opening_entry": current_opening_entry}
	else:
		frappe.logger().info("No active POS opening entry found, showing all POS invoices")
		filters = {"custom_pos_opening_entry": ["!=", ""]}

	sales_invoice_meta = frappe.get_meta("Sales Invoice")
	has_zatca_status = any(df.fieldname == "custom_zatca_submit_status" for df in sales_invoice_meta.fields)

	fields = [
		"name",
		"posting_date",
		"posting_time",
		"owner",
		"customer",
		"customer_name",
		"base_grand_total",
		"base_rounded_total",
		"status",
		"discount_amount",
		"total_taxes_and_charges",
		"custom_pos_opening_entry",
		"pos_profile",
		"currency",
	]

	if has_zatca_status:
		fields.append("custom_zatca_submit_status")

	if cashier_user_ids:
		if len(cashier_user_ids) == 1:
			filters["owner"] = cashier_user_ids[0]
		else:
			filters["owner"] = ["in", cashier_user_ids]
		frappe.logger().info(f"Filtering by cashier user IDs: {cashier_user_ids}")

	return filters, fields


def _build_search_filters(search):
	"""Build OR filters for search functionality."""
	if not search or not search.strip():
		return None

	search_term = search.strip()
	return [
		["name", "like", f"%{search_term}%"],
		["customer_name", "like", f"%{search_term}%"],
		["customer", "like", f"%{search_term}%"],
	]


def _batch_fetch_cashier_names(user_ids):
	"""Batch fetch cashier names for given user IDs."""
	if not user_ids:
		return {}

	cashier_query = """
		SELECT name, full_name
		FROM `tabUser`
		WHERE name IN ({})
	""".format(",".join([f"'{uid}'" for uid in user_ids]))
	cashier_results = frappe.db.sql(cashier_query, as_dict=True)
	return {user.name: user.full_name or user.name for user in cashier_results}


def _batch_fetch_payment_methods(invoice_names):
	"""Batch fetch payment methods for given invoices."""
	if not invoice_names:
		return {}

	payment_query = """
		SELECT parent, mode_of_payment, amount
		FROM `tabSales Invoice Payment`
		WHERE parent IN ({})
	""".format(",".join([f"'{name}'" for name in invoice_names]))
	payment_results = frappe.db.sql(payment_query, as_dict=True)

	# Group by parent invoice
	payment_methods_map = {}
	for payment in payment_results:
		if payment.parent not in payment_methods_map:
			payment_methods_map[payment.parent] = []
		payment_methods_map[payment.parent].append(
			{"mode_of_payment": payment.mode_of_payment, "amount": payment.amount}
		)

	return payment_methods_map


def _batch_fetch_items(invoice_names):
	"""Batch fetch items for given invoices."""
	if not invoice_names:
		return {}

	items_query = """
		SELECT parent, item_code, qty, rate, amount
		FROM `tabSales Invoice Item`
		WHERE parent IN ({})
	""".format(",".join([f"'{name}'" for name in invoice_names]))
	items_results = frappe.db.sql(items_query, as_dict=True)

	# Group by parent invoice
	items_map = {}
	for item in items_results:
		if item.parent not in items_map:
			items_map[item.parent] = []
		items_map[item.parent].append(
			{
				"item_code": item.item_code,
				"qty": item.qty,
				"rate": item.rate,
				"amount": item.amount,
				"quantity": item.qty,
			}
		)

	return items_map


def _process_invoices(invoices, cashier_names_map, payment_methods_map, items_map):
	"""Process and enrich invoices with related data."""
	for inv in invoices:
		# Set cashier name
		inv["cashier_name"] = cashier_names_map.get(inv.owner, inv.owner)

		# Format posting_time
		if inv.get("posting_time"):
			if hasattr(inv["posting_time"], "total_seconds"):
				total_seconds = int(inv["posting_time"].total_seconds())
				hours = total_seconds // 3600
				minutes = (total_seconds % 3600) // 60
				seconds = total_seconds % 60
				inv["posting_time"] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
			else:
				inv["posting_time"] = str(inv["posting_time"])

		# Set payment methods
		payment_methods = payment_methods_map.get(inv.name, [])
		inv["payment_methods"] = payment_methods

		# Set backward-compatible mode_of_payment field
		if len(payment_methods) == 0:
			inv["mode_of_payment"] = "-"
		elif len(payment_methods) == 1:
			inv["mode_of_payment"] = payment_methods[0]["mode_of_payment"]
		else:
			inv["mode_of_payment"] = "/".join([pm["mode_of_payment"] for pm in payment_methods])

		# Set items and calculate return data
		items = items_map.get(inv.name, [])

		# Only calculate return data for Credit Note Issued invoices
		if inv.get("status") == "Credit Note Issued":
			_calculate_return_quantities(inv, items)
		else:
			for item in items:
				item["returned_qty"] = 0
				item["available_qty"] = item["qty"]

		inv["items"] = items


def _calculate_return_quantities(invoice, items):
	"""Calculate return quantities for credit note invoices."""
	item_codes = [item["item_code"] for item in items]
	if not item_codes:
		return

	returns_query = """
		SELECT sii.item_code, COALESCE(SUM(ABS(sii.qty)), 0) as total_returned_qty
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
		WHERE si.is_return = 1
		  AND si.return_against = %s
		  AND sii.item_code IN ({})
		  AND si.docstatus = 1
		  AND si.customer = %s
		GROUP BY sii.item_code
	""".format(",".join([f"'{code}'" for code in item_codes]))

	returns_data = frappe.db.sql(returns_query, (invoice.name, invoice.customer), as_dict=True)
	returned_qty_map = {row.item_code: row.total_returned_qty for row in returns_data}

	# Update items with return data
	for item in items:
		returned_qty_value = returned_qty_map.get(item["item_code"], 0)
		item["returned_qty"] = round(float(returned_qty_value), 6)
		item["available_qty"] = round(item["qty"] - returned_qty_value, 6)


@frappe.whitelist(allow_guest=True)
def get_invoice_details(invoice_id):
	"""
	Main function to fetch complete invoice details.
	"""
	try:
		invoice = frappe.get_doc("Sales Invoice", invoice_id)
		invoice_data = invoice.as_dict()

		# Get items with return data
		items = _get_invoice_items_with_returns(invoice_id, invoice.customer)

		# Get address and customer information
		address_data = _get_address_and_customer_info(invoice)

		# Format posting time
		if invoice_data.get("posting_time"):
			if hasattr(invoice_data["posting_time"], "total_seconds"):
				total_seconds = int(invoice_data["posting_time"].total_seconds())
				hours = total_seconds // 3600
				minutes = (total_seconds % 3600) // 60
				seconds = total_seconds % 60
				invoice_data["posting_time"] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
			else:
				invoice_data["posting_time"] = str(invoice_data["posting_time"])

		# Get cashier full name
		cashier_name = frappe.db.get_value(
			"User", invoice_data.get("owner"), "full_name"
		) or invoice_data.get("owner")
		invoice_data["cashier_name"] = cashier_name

		return {
			"success": True,
			"data": {
				**invoice_data,
				"items": items,
				**address_data,
			},
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error fetching invoice {invoice_id}")
		return {"success": False, "error": str(e)}


@frappe.whitelist(allow_guest=True)
def check_invoice_return_eligibility(invoice_id):
	"""
	Check if an invoice can be returned based on item restrictions.
	Returns can_return boolean and reason if not returnable.
	"""
	try:
		invoice = frappe.get_doc("Sales Invoice", invoice_id)

		if invoice.is_return:
			return {"can_return": False, "reason": "This invoice is already a return."}

		if invoice.docstatus != 1:
			return {"can_return": False, "reason": "Only submitted invoices can be returned."}

		# Use the validation function
		can_return, error_message = validate_return_restrictions(invoice)

		return {
			"can_return": can_return,
			"reason": error_message if not can_return else None,
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error checking return eligibility for invoice {invoice_id}")
		return {"can_return": False, "reason": f"Error checking eligibility: {str(e)}"}


def _get_invoice_items_with_returns(invoice_id, customer):
	"""
	Fetch invoice items and calculate returned/available quantities.
	Includes item_group and custom_is_refrigerated_ for return validation.
	"""
	# Batch fetch all items for this invoice with item_group
	items_query = """
		SELECT sii.item_code, sii.item_name, sii.qty, sii.rate, sii.amount, sii.description, sii.item_group
		FROM `tabSales Invoice Item` sii
		WHERE sii.parent = %s
	"""
	items_data = frappe.db.sql(items_query, (invoice_id,), as_dict=True)

	# Batch fetch return quantities for all items at once
	item_codes = [item.item_code for item in items_data]
	returned_qty_map = {}

	if item_codes:
		returns_query = """
			SELECT sii.item_code, COALESCE(SUM(ABS(sii.qty)), 0) as total_returned_qty
			FROM `tabSales Invoice` si
			JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
			WHERE si.is_return = 1
			  AND si.return_against = %s
			  AND sii.item_code IN ({})
			  AND si.docstatus = 1
			  AND si.customer = %s
			GROUP BY sii.item_code
		""".format(",".join([f"'{code}'" for code in item_codes]))

		returns_data = frappe.db.sql(returns_query, (invoice_id, customer), as_dict=True)
		returned_qty_map = {row.item_code: row.total_returned_qty for row in returns_data}

	# Batch fetch item custom fields and item group flags
	item_group_map = {}
	item_refrigerated_map = {}

	if item_codes:
		item_groups = list(set([item.item_group for item in items_data if item.item_group]))
		if item_groups:
			item_group_query = """
				SELECT name, custom_non_returnable
				FROM `tabItem Group`
				WHERE name IN ({})
			""".format(",".join([f"'{ig}'" for ig in item_groups]))
			ig_data = frappe.db.sql(item_group_query, as_dict=True)
			item_group_map = {ig.name: bool(ig.custom_non_returnable) for ig in ig_data}

		# Fetch item custom_is_refrigerated_ flag
		if frappe.db.has_column("Item", "custom_is_refrigerated_"):
			item_query = """
				SELECT name, custom_is_refrigerated_
				FROM `tabItem`
				WHERE name IN ({})
			""".format(",".join([f"'{code}'" for code in item_codes]))
			item_data = frappe.db.sql(item_query, as_dict=True)
			item_refrigerated_map = {item.name: bool(item.custom_is_refrigerated_) for item in item_data}

	# Get invoice date for refrigerated check
	invoice_doc = frappe.get_doc("Sales Invoice", invoice_id)
	invoice_date_raw = invoice_doc.posting_date or invoice_doc.creation

	invoice_date = None
	try:
		if invoice_date_raw:
			invoice_date = frappe.utils.getdate(invoice_date_raw)
			if not isinstance(invoice_date, date_type):
				invoice_date = frappe.utils.getdate(str(invoice_date_raw))
	except Exception:
		pass

	# Fallback to today if conversion failed
	if not invoice_date or not isinstance(invoice_date, date_type):
		invoice_date = frappe.utils.today()
		if not isinstance(invoice_date, date_type):
			from datetime import datetime
			try:
				if isinstance(invoice_date, str):
					invoice_date = datetime.strptime(invoice_date, "%Y-%m-%d").date()
				else:
					invoice_date = frappe.utils.today()
			except Exception:
				invoice_date = frappe.utils.today()

	# Get today's date
	today_date = frappe.utils.today()
	if not isinstance(today_date, date_type):
		today_date = frappe.utils.getdate(today_date)

	days_since_invoice = (today_date - invoice_date).days

	items = []
	for item in items_data:
		returned_qty_value = returned_qty_map.get(item.item_code, 0)
		available_qty = round(item.qty - returned_qty_value, 6)

		# NEW RULE: If invoice is older than 14 days, mark all items as non-returnable
		if days_since_invoice > 14:

			items.append(
				{
					"item_code": item.item_code,
					"item_name": item.item_name,
					"qty": item.qty,
					"rate": item.rate,
					"amount": item.amount,
					"description": item.description,
					"returned_qty": returned_qty_value,
					"available_qty": available_qty,
					"item_group": item.item_group,
					"is_non_returnable": True,
					"is_refrigerated_overdue": False,
				}
			)
			continue


		is_non_returnable = False
		if item.item_group and item.item_group in item_group_map:
			is_non_returnable = item_group_map[item.item_group]

		is_refrigerated = False
		if item.item_code in item_refrigerated_map:
			is_refrigerated = item_refrigerated_map[item.item_code]

		items.append(
			{
				"item_code": item.item_code,
				"item_name": item.item_name,
				"qty": item.qty,
				"rate": item.rate,
				"amount": item.amount,
				"description": item.description,
				"returned_qty": returned_qty_value,
				"available_qty": available_qty,
				"item_group": item.item_group,
				"is_non_returnable": is_non_returnable,
				"is_refrigerated_overdue": is_refrigerated,
			}
		)

	return items


def _get_address_and_customer_info(invoice):
	"""
	Fetch company address, customer address, and customer contact information.
	"""
	# Get company address
	company_address_doc = None
	if invoice.company_address:
		company_address_doc = frappe.get_doc("Address", invoice.company_address).as_dict()

	# Get customer address
	customer_address_doc = None
	if invoice.customer_address:
		customer_address_doc = frappe.get_doc("Address", invoice.customer_address).as_dict()
	else:
		primary_address = frappe.db.get_value(
			"Dynamic Link",
			{
				"link_doctype": "Customer",
				"link_name": invoice.customer,
				"parenttype": "Address",
			},
			"parent",
		)
		if primary_address:
			customer_address_doc = frappe.get_doc("Address", primary_address).as_dict()

	# Get customer contact information
	customer_email = ""
	customer_mobile_no = ""
	customer_address_line1 = ""
	customer_city = ""
	customer_state = ""
	customer_pincode = ""
	customer_country = ""

	if invoice.customer:
		customer_doc = frappe.get_doc("Customer", invoice.customer)
		customer_email = customer_doc.email_id or ""
		customer_mobile_no = customer_doc.mobile_no or ""

		# Extract address fields
		if customer_address_doc:
			customer_address_line1 = customer_address_doc.get("address_line1", "")
			customer_city = customer_address_doc.get("city", "")
			customer_state = customer_address_doc.get("state", "")
			customer_pincode = customer_address_doc.get("pincode", "")
			customer_country = customer_address_doc.get("country", "")

	return {
		"company_address_doc": company_address_doc,
		"customer_address_doc": customer_address_doc,
		"customer_email": customer_email,
		"customer_mobile_no": customer_mobile_no,
		"customer_address_line1": customer_address_line1,
		"customer_city": customer_city,
		"customer_state": customer_state,
		"customer_pincode": customer_pincode,
		"customer_country": customer_country,
	}


@frappe.whitelist()
def create_and_submit_invoice(data):
	try:
		import time

		start_time = time.time()

		# Validate input data
		if not data:
			frappe.throw("No data provided for invoice creation")

		(
			customer,
			items,
			amount_paid,
			sales_and_tax_charges,
			mode_of_payment,
			business_type,
			roundoff_amount,
			delivery_personnel,
			delivery_via,
			reference_no,
			medication_order,
			redeem_loyalty_points,
			loyalty_points,
			general_additional_amount,
			additional_remark,
			delivery_distance_km,
			delivery_charge_amount,
		) = parse_invoice_data(data)

		# Validate required fields
		if not customer:
			frappe.throw("Customer is required")
		if not items or len(items) == 0:
			frappe.throw("At least one item is required")

		# Build invoice document
		doc = build_sales_invoice_doc(
			customer,
			items,
			amount_paid,
			sales_and_tax_charges,
			mode_of_payment,
			business_type,
			roundoff_amount,
			include_payments=True,
			delivery_personnel=delivery_personnel,
			delivery_via=delivery_via,
			reference_no=reference_no,
			medication_order=medication_order,
			redeem_loyalty_points=redeem_loyalty_points,
			loyalty_points=loyalty_points,
			general_additional_amount=general_additional_amount,
			additional_remark=additional_remark,
			delivery_distance_km=delivery_distance_km,
			delivery_charge_amount=delivery_charge_amount,
		)

		doc.base_paid_amount = amount_paid
		doc.paid_amount = amount_paid
		doc.outstanding_amount = 0

		# Save and submit in one transaction
		doc.save(ignore_permissions=True)
		doc.submit()

		payment_entry = None
		should_create_payment_entry = False

		if business_type == "B2B":
			should_create_payment_entry = True
		elif business_type == "B2B & B2C":
			# For B2B & B2C, only create payment entry for company customers
			global _cached_customer_data
			if customer not in _cached_customer_data:
				_cached_customer_data[customer] = frappe.get_doc("Customer", customer)

			customer_doc = _cached_customer_data[customer]
			if customer_doc.customer_type == "Company":
				should_create_payment_entry = True

		if should_create_payment_entry and mode_of_payment and amount_paid > 0:
			try:
				payment_entry = create_payment_entry(doc, mode_of_payment, amount_paid)
			except Exception:
				frappe.log_error(frappe.get_traceback(), f"Payment Entry Error for {doc.name}")
				payment_entry = None

		processing_time = time.time() - start_time
		frappe.logger().info(f"Invoice {doc.name} processed in {processing_time:.2f} seconds")

		# Return minimal invoice data for frontend performance
		return {
			"success": True,
			"invoice_name": doc.name,
			"invoice_id": doc.name,
			"invoice": {
				"name": doc.name,
				"doctype": doc.doctype,
				"customer": doc.customer,
				"customer_name": doc.customer_name,
				"posting_date": doc.posting_date,
				"base_grand_total": doc.base_grand_total,
				"currency": doc.currency,
				"status": doc.status,
				"is_pos": doc.is_pos,
				"company": doc.company,
			},
			"payment_entry": payment_entry.name if payment_entry else None,
			"processing_time": round(processing_time, 2),
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Submit Invoice Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def create_draft_invoice(data):
	try:
		(
			customer,
			items,
			amount_paid,
			sales_and_tax_charges,
			mode_of_payment,
			business_type,
			roundoff_amount,
			delivery_personnel,
			delivery_via,
			reference_no,
			medication_order,
			redeem_loyalty_points,
			loyalty_points,
			general_additional_amount,
			additional_remark,
			delivery_distance_km,
			delivery_charge_amount,
		) = parse_invoice_data(data)
		doc = build_sales_invoice_doc(
			customer,
			items,
			amount_paid,
			sales_and_tax_charges,
			mode_of_payment,
			business_type,
			roundoff_amount,
			include_payments=True,
			delivery_personnel=delivery_personnel,
			delivery_via=delivery_via,
			reference_no=reference_no,
			medication_order=medication_order,
			redeem_loyalty_points=redeem_loyalty_points,
			loyalty_points=loyalty_points,
			general_additional_amount=general_additional_amount,
			additional_remark=additional_remark,
			delivery_distance_km=delivery_distance_km,
			delivery_charge_amount=delivery_charge_amount,
		)
		doc.insert(ignore_permissions=True)

		return {"success": True, "invoice_name": doc.name, "invoice": doc}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Draft Invoice Error")
		return {"success": False, "message": str(e)}


def parse_invoice_data(data):
	"""Sanitize and extract customer and items from request payload including round-off."""
	if isinstance(data, str):
		data = json.loads(data)

	customer = data.get("customer", {}).get("id")
	items = data.get("items", [])

	amount_paid = 0.0
	sales_and_tax_charges = get_current_pos_profile().taxes_and_charges
	business_type = data.get("businessType")
	mode_of_payment = None

	# Extract round-off data from frontend
	roundoff_amount = data.get("roundOffAmount", 0.0)

	# Only get round-off account if round-off amount is not zero
	if roundoff_amount != 0:
		_roundoff_account = get_writeoff_account()

	if data.get("amountPaid"):
		amount_paid = data.get("amountPaid")

	if data.get("paymentMethods"):
		mode_of_payment = data.get("paymentMethods")

	if data.get("SalesTaxCharges"):
		sales_and_tax_charges = data.get("SalesTaxCharges")

	# Extract delivery personnel
	delivery_personnel = data.get("deliveryPersonnel")
	# Extract delivery channel (custom field on Sales Invoice)
	delivery_via = data.get("deliveryVia")
	# Extract reference no (custom field on Sales Invoice)
	reference_no = data.get("referenceNo") or data.get("reference_no")
	# Extract Patient Medication Order (when items came from medication order)
	medication_order = data.get("medicationOrder")
	# Fallback: extract from items if top-level medicationOrder is empty (e.g. mobile payment flow)
	if not medication_order and items:
		orders_from_items = set()
		for it in items:
			mo = it.get("medicationOrder") or it.get("medication_order")
			if mo:
				orders_from_items.add(mo)
		if orders_from_items:
			medication_order = list(orders_from_items)

	# Loyalty points redemption (ERPNext standard)
	redeem_loyalty_points = cint(data.get("redeemLoyaltyPoints") or data.get("redeem_loyalty_points") or 0)
	loyalty_points = cint(data.get("loyaltyPoints") or data.get("loyalty_points") or 0)
	if redeem_loyalty_points and loyalty_points <= 0:
		loyalty_points = 0
		redeem_loyalty_points = 0

	# General additional amount (e.g. syringe, misc) - only when POS allows
	general_additional_amount = flt(
		data.get("generalAdditionalAmount") or data.get("general_additional_amount") or 0
	)
	additional_remark = data.get("additionalRemark") or data.get("additional_remark")

	# Delivery distance (km) and delivery charge amount (from Select Delivery Personnel modal)
	delivery_distance_km = flt(
		data.get("deliveryDistanceKm") or data.get("delivery_distance_km") or 0
	)
	delivery_charge_amount = flt(
		data.get("deliveryChargeAmount") or data.get("delivery_charge_amount") or 0
	)

	if not customer or not items:
		frappe.throw(_("Customer and items are required"))

	return (
		customer,
		items,
		amount_paid,
		sales_and_tax_charges,
		mode_of_payment,
		business_type,
		roundoff_amount,
		delivery_personnel,
		delivery_via,
		reference_no,
		medication_order,
		redeem_loyalty_points,
		loyalty_points,
		general_additional_amount,
		additional_remark,
		delivery_distance_km,
		delivery_charge_amount,
	)


def build_sales_invoice_doc(
	customer,
	items,
	amount_paid,
	sales_and_tax_charges,
	mode_of_payment,
	business_type,
	roundoff_amount=0.0,
	include_payments=False,
	delivery_personnel=None,
	delivery_via=None,
	reference_no=None,
	medication_order=None,
	redeem_loyalty_points=0,
	loyalty_points=0,
	general_additional_amount=0.0,
	additional_remark=None,
	delivery_distance_km=0.0,
	delivery_charge_amount=0.0,
):
	"""Main function to build a sales invoice document."""
	doc = frappe.new_doc("Sales Invoice")
	doc.customer = customer
	doc.due_date = frappe.utils.nowdate()
	doc.custom_delivery_date = frappe.utils.nowdate()

	doc.ignore_pricing_rule = 1

	if delivery_personnel:
		doc.custom_delivery_personnel = delivery_personnel

	if delivery_via and frappe.db.has_column("Sales Invoice", "custom_delivery_via"):
		doc.custom_delivery_via = delivery_via
	# Set reference no if provided and field exists
	if reference_no and frappe.db.has_column("Sales Invoice", "custom_reference_no"):
		doc.custom_reference_no = reference_no
	# Set Patient Medication Orders (Table MultiSelect) if items came from orders and field exists
	if medication_order and frappe.db.has_column("Sales Invoice", "custom_medication_order"):
		orders = medication_order

		if isinstance(orders, str):
			orders = [orders]
		elif isinstance(orders, (set, tuple)):
			orders = list(orders)
		elif not isinstance(orders, list):
			orders = [orders]

		for order_name in orders:
			if not order_name:
				continue
			# custom_medication_order is a Table MultiSelect of child doctype "Medication Details"
			# which has a Link field "medication_order" to "Patient Medication Order"
			doc.append("custom_medication_order", {"medication_order": order_name})

		# Also set the Patient on Sales Invoice (healthcare) if the standard patient field exists.
		# Use the patient from the first medication order.
		if frappe.db.has_column("Sales Invoice", "patient"):
			first_order = orders[0]
			if first_order:
				try:
					patient_name = frappe.db.get_value(
						"Patient Medication Order", first_order, "patient"
					)
					if patient_name:
						doc.patient = patient_name
				except Exception:
					frappe.log_error(
						frappe.get_traceback(),
						f"Error setting patient from Medication Order {first_order}",
					)

	# Configure POS profile and company settings
	pos_profile = _get_active_pos_profile()
	_set_pos_profile_fields(doc, pos_profile, customer, business_type)

	# Set additional remark on invoice if field exists
	if additional_remark and frappe.db.has_column("Sales Invoice", "custom_remark"):
		doc.custom_remark = additional_remark

	_set_posting_fields(doc)

	_set_pos_opening_entry(doc)

	_set_roundoff_fields(doc, roundoff_amount)

	_set_taxes_and_charges(doc, sales_and_tax_charges, pos_profile)

	_populate_invoice_items(doc, items, pos_profile)

	_append_additional_charge_items(doc, items, general_additional_amount, pos_profile, additional_remark)

	# Delivery charge as a separate invoice item
	_append_delivery_charge_item(doc, delivery_charge_amount, pos_profile, delivery_distance_km)

	_populate_tax_details(doc)

	_add_additional_amounts_to_taxes(doc, items, general_additional_amount, pos_profile)

	# Add payment information
	if include_payments:
		_add_payment_entries(doc, mode_of_payment)

	# Loyalty points redemption (ERPNext standard); validate_loyalty_points will set loyalty_amount on validate
	if redeem_loyalty_points and loyalty_points and cint(loyalty_points) > 0:
		doc.redeem_loyalty_points = 1
		doc.loyalty_points = cint(loyalty_points)

	return doc


def _get_active_pos_profile():
	"""Get the active POS profile from current session or fallback to default."""
	selected_pos_profile_name = None

	try:
		current_opening_entry = get_current_pos_opening_entry()
		if current_opening_entry:
			opening_doc = frappe.get_doc("POS Opening Entry", current_opening_entry)
			selected_pos_profile_name = opening_doc.pos_profile
	except Exception:
		frappe.logger().error(f"Error getting POS Opening Entry: {frappe.get_traceback()}")
		pass

	try:
		if selected_pos_profile_name:
			pos_profile_doc = frappe.get_doc("POS Profile", selected_pos_profile_name)
			return pos_profile_doc
		else:
			fallback_profile = get_current_pos_profile()
			return fallback_profile
	except Exception:
		frappe.logger().error(f"Error getting POS Profile: {frappe.get_traceback()}")
		frappe.logger().error(f"Attempted to get profile: {selected_pos_profile_name}")
		raise


def _set_pos_profile_fields(doc, pos_profile, customer, business_type):
	"""Set POS profile, company, currency and POS-specific fields."""
	doc.pos_profile = pos_profile.name
	doc.company = pos_profile.company
	doc.currency = get_customer_billing_currency(customer)
	doc.conversion_rate = 1.0
	doc.update_stock = 1
	doc.warehouse = pos_profile.warehouse

	# Determine if this is a POS invoice
	doc.is_pos = _determine_is_pos(customer, business_type)


def _determine_is_pos(customer, business_type):
	"""Determine if the invoice should be marked as POS based on business type."""
	if business_type == "B2C":
		return 1
	elif business_type == "B2B":
		return 0
	elif business_type == "B2B & B2C":
		return _check_customer_type_for_pos(customer)
	else:
		return 0


def _check_customer_type_for_pos(customer):
	"""Check if customer is an individual for B2B & B2C business type."""
	global _cached_customer_data
	if customer not in _cached_customer_data:
		_cached_customer_data[customer] = frappe.get_doc("Customer", customer)

	customer_doc = _cached_customer_data[customer]
	return 1 if customer_doc.customer_type == "Individual" else 0


def _set_posting_fields(doc):
	"""Set posting date, time and related fields."""
	doc.posting_date = frappe.utils.nowdate()
	doc.posting_time = frappe.utils.nowtime()
	doc.set_posting_time = 1


def _set_pos_opening_entry(doc):
	"""Set the current POS opening entry on the document."""
	current_opening_entry = get_current_pos_opening_entry()
	if current_opening_entry:
		doc.custom_pos_opening_entry = current_opening_entry


def _set_roundoff_fields(doc, roundoff_amount):
	"""Set round-off amount and account if roundoff is non-zero."""
	if roundoff_amount != 0:
		conversion_rate = doc.conversion_rate or 1
		doc.custom_roundoff_amount = flt(abs(roundoff_amount))
		doc.custom_roundoff_account = get_writeoff_account()
		doc.custom_base_roundoff_amount = flt(abs(roundoff_amount) * conversion_rate)


def _set_taxes_and_charges(doc, sales_and_tax_charges, pos_profile):
	"""Set the taxes and charges template. When item tax template mode is enabled, do not set."""
	if getattr(pos_profile, "custom_allow_item_tax_template", 0):
		return
	if sales_and_tax_charges:
		doc.taxes_and_charges = sales_and_tax_charges
	else:
		doc.taxes_and_charges = pos_profile.taxes_and_charges


def _populate_invoice_items(doc, items, pos_profile):
	"""Add all items to the invoice."""
	item_codes = [item.get("id") for item in items]

	# Batch fetch item data and pre-cache accounts
	item_data_map = _batch_fetch_item_data(item_codes)
	_precache_item_accounts(item_codes, pos_profile.company)

	# Add each item to the invoice
	for item in items:
		item_data = _prepare_item_data(item, item_data_map, pos_profile)
		doc.append("items", item_data)


def _batch_fetch_item_data(item_codes):
	"""Batch fetch item data for all items."""
	if not item_codes:
		return {}

	item_query = """
		SELECT name, has_batch_no, has_serial_no
		FROM `tabItem`
		WHERE name IN ({})
	""".format(",".join([f"'{code}'" for code in item_codes]))

	item_results = frappe.db.sql(item_query, as_dict=True)
	return {item.name: item for item in item_results}


def _precache_item_accounts(item_codes, company):
	"""Pre-cache income and expense accounts for all items."""
	if not item_codes:
		return

	# Cache company data
	if company not in _cached_company_data:
		_cached_company_data[company] = frappe.get_doc("Company", company)

	company_doc = _cached_company_data[company]
	income_account = company_doc.default_income_account
	expense_account = company_doc.default_expense_account

	# Pre-populate account cache
	for item_code in item_codes:
		_cached_item_accounts[item_code] = income_account
		_cached_item_accounts[f"{item_code}_expense"] = expense_account


def _prepare_item_data(item, item_data_map, pos_profile):
	"""Prepare item data dictionary for invoice line."""
	item_code = item.get("id")

	# Get accounts and validate
	income_account = get_income_accounts(item_code)
	expense_account = get_expense_accounts(item_code)
	_validate_item_accounts(item_code, income_account, expense_account)

	# Build base item data
	item_data = {
		"item_code": item_code,
		"qty": item.get("quantity"),
		"rate": item.get("price"),
		"income_account": income_account,
		"expense_account": expense_account,
		"warehouse": pos_profile.warehouse,
		"cost_center": pos_profile.cost_center,
	}

	# and HARD-ENFORCE zero rate on invoice line for free items
	# Set allow_zero_valuation_rate so stock ledger accepts zero rate (per-row setting)
	if item.get("is_free_item"):
		item_data["is_free_item"] = 1
		item_data["rate"] = 0
		item_data["allow_zero_valuation_rate"] = 1
	item_data["allow_zero_valuation_rate"] = 1


	# Add optional fields
	_add_uom_to_item(item_data, item)
	_add_batch_to_item(item_data, item, item_data_map.get(item_code, {}))
	_add_serial_to_item(item_data, item)
	_add_dosage_to_item(item_data, item)
	_add_item_tax_template_to_item(item_data, item, pos_profile)

	return item_data


def _validate_item_accounts(item_code, income_account, expense_account):
	"""Validate that required accounts exist for the item."""
	if not income_account:
		frappe.throw(
			f"Income account not found for item {item_code}. "
			"Please check item defaults or company settings."
		)
	if not expense_account:
		frappe.throw(
			f"Expense account not found for item {item_code}. "
			"Please check item defaults or company settings."
		)


def _add_uom_to_item(item_data, item):
	"""Add UOM to item data if specified and not default."""
	selected_uom = item.get("uom")
	if selected_uom and selected_uom != "Nos":
		item_data["uom"] = selected_uom


def _add_batch_to_item(item_data, item, item_db_data):
	"""Add batch information if item has batch tracking."""
	has_batch_no = item_db_data.get("has_batch_no", 0)
	batch_number = item.get("batchNumber")

	if has_batch_no and batch_number:
		item_data["use_serial_batch_fields"] = 1
		item_data["batch_no"] = batch_number


def _add_serial_to_item(item_data, item):
	"""Add serial number if provided."""
	serial_number = item.get("serialNumber")
	if serial_number:
		item_data["use_serial_batch_fields"] = 1
		item_data["serial_no"] = serial_number


def _add_dosage_to_item(item_data, item):
	"""Add dosage and prescription dosage to invoice item if Sales Invoice Item has custom fields."""
	if frappe.db.has_column("Sales Invoice Item", "custom_dosage"):
		dosage = item.get("dosage")
		if dosage is not None and dosage != "":
			item_data["custom_dosage"] = dosage
	if frappe.db.has_column("Sales Invoice Item", "custom_prescription_dosage"):
		prescription_dosage = item.get("prescriptionDosage") or item.get("prescription_dosage")
		if prescription_dosage:
			item_data["custom_prescription_dosage"] = prescription_dosage


def _add_item_tax_template_to_item(item_data, item, pos_profile):
	"""Add item_tax_template to invoice item when POS profile allows item tax template mode."""
	if not getattr(pos_profile, "custom_allow_item_tax_template", 0):
		return
	item_tax_template = item.get("item_tax_template") or item.get("itemTaxTemplate")
	if item_tax_template:
		item_data["item_tax_template"] = item_tax_template


def _append_additional_charge_items(doc, items, general_additional_amount, pos_profile, additional_remark=None):
	"""Map additional amounts to a dedicated service Item (custom_is_additional_charges = 1)."""
	# Sum per-item additional amounts from payload
	total_item_additional = sum(
		flt(it.get("additional_amount") or it.get("additionalAmount") or 0) for it in items
	)

	general_additional_amount = flt(general_additional_amount or 0)

	if total_item_additional <= 0 and general_additional_amount <= 0:
		return

	# Find the special service item
	try:
		extra_item_code = frappe.db.get_value(
			"Item",
			{"custom_is_additional_charges": 1, "disabled": 0},
			"name",
		)
	except Exception:
		extra_item_code = None

	if not extra_item_code:
		frappe.log_error(
			"Additional charges item not found",
			"Item with custom_is_additional_charges=1 is required for additional amounts",
		)
		return

	warehouse = pos_profile.warehouse
	cost_center = pos_profile.cost_center

	# Per-item aggregated additional charges
	if total_item_additional > 0:
		doc.append(
			"items",
			{
				"item_code": extra_item_code,
				"qty": 1,
				"rate": flt(total_item_additional, doc.precision("grand_total") or 2),
				"description": "Item-based additional charges",
				"warehouse": warehouse,
				"cost_center": cost_center,
			},
		)

	# General additional amount
	if general_additional_amount > 0:
		doc.append(
			"items",
			{
				"item_code": extra_item_code,
				"qty": 1,
				"rate": flt(general_additional_amount, doc.precision("grand_total") or 2),
				"description": additional_remark or "Additional charges",
				"warehouse": warehouse,
				"cost_center": cost_center,
			},
		)


def _append_delivery_charge_item(doc, delivery_charge_amount, pos_profile, delivery_distance_km=0.0):
	"""Append Delivery Charge as a dedicated item row, if any amount was provided."""

	delivery_charge_amount = flt(delivery_charge_amount or 0)
	if delivery_charge_amount <= 0:
		return

	from klik_pos.api.delivery_charges import _ensure_delivery_charge_item

	try:
		item_code = _ensure_delivery_charge_item()
	except Exception:
		frappe.log_error(
			frappe.get_traceback(),
			"Failed to ensure Delivery Charge item",
		)
		return

	warehouse = getattr(pos_profile, "warehouse", None)
	cost_center = getattr(pos_profile, "cost_center", None)

	description = "Delivery Charge"
	if delivery_distance_km:
		description = f"Delivery Charge ({flt(delivery_distance_km)} km)"

	doc.append(
		"items",
		{
			"item_code": item_code,
			"qty": 1,
			"rate": flt(delivery_charge_amount, doc.precision("grand_total") or 2),
			"description": description,
			"warehouse": warehouse,
			"cost_center": cost_center,
		},
	)


def _populate_tax_details(doc):
	"""Populate tax details from the taxes and charges template."""
	if not doc.taxes_and_charges:
		return

	tax_doc = get_tax_template(doc.taxes_and_charges)
	if not tax_doc:
		return

	for tax in tax_doc.taxes:
		doc.append(
			"taxes",
			{
				"charge_type": tax.charge_type,
				"account_head": tax.account_head,
				"description": tax.description,
				"cost_center": tax.cost_center,
				"rate": tax.rate,
				"row_id": tax.row_id,
				"tax_amount": tax.tax_amount,
				"included_in_print_rate": tax.included_in_print_rate,
			},
		)


def _add_additional_amounts_to_taxes(doc, items, general_additional_amount, pos_profile):
	"""Do NOT push additional amounts into the Sales Taxes and Charges table.

	Updated requirement:
	- Additional amounts should be treated purely as separate line items
	  (see _append_additional_charge_items) and must not appear as
	  Actual rows under any account in the taxes table.
	"""
	return


def _add_payment_entries(doc, mode_of_payment):
	"""Add payment entries to the invoice."""
	if not isinstance(mode_of_payment, list):
		return

	for payment in mode_of_payment:
		doc.append(
			"payments",
			{"mode_of_payment": payment["method"], "amount": payment["amount"]},
		)


def get_tax_template(template_name):
	"""
	Optimized tax template getter with caching.
	Custom helper function to fetch Sales Taxes and Charges Template.
	Returns the full template document or raises an error if not found.
	"""
	global _cached_item_accounts

	if not template_name:
		return None

	cache_key = f"tax_template_{template_name}"
	if cache_key not in _cached_item_accounts:
		try:
			template_doc = frappe.get_doc("Sales Taxes and Charges Template", template_name)
			_cached_item_accounts[cache_key] = template_doc
		except frappe.DoesNotExistError:
			frappe.throw(f"Tax Template '{template_name}' not found")
		except Exception as e:
			frappe.log_error(f"Error fetching tax template {template_name}: {e!s}")
			_cached_item_accounts[cache_key] = None

	return _cached_item_accounts[cache_key]

def get_item_tax_template(template_name):
	"""
	Optimized tax template getter with caching.
	Custom helper function to fetch Item Tax Template.
	Returns the full template document or raises an error if not found.
	"""
	global _cached_item_accounts

	if not template_name:
		return None

	cache_key = f"item_tax_template_{template_name}"
	if cache_key not in _cached_item_accounts:
		try:
			# Fetch Item Tax Template instead of Sales Taxes and Charges Template
			template_doc = frappe.get_doc("Item Tax Template", template_name)
			_cached_item_accounts[cache_key] = template_doc
		except frappe.DoesNotExistError:
			frappe.throw(f"Item Tax Template '{template_name}' not found")
		except Exception as e:
			frappe.log_error(f"Error fetching item tax template {template_name}: {e!s}")
			_cached_item_accounts[cache_key] = None

	return _cached_item_accounts[cache_key]

def get_customer_billing_currency(customer):
	try:
		customer_doc = frappe.get_doc("Customer", customer)
		if customer_doc.default_currency:
			return customer_doc.default_currency
	except Exception:
		pass

	# Fallback to company currency
	pos_profile = get_current_pos_profile()
	company_doc = frappe.get_doc("Company", pos_profile.company)
	return company_doc.default_currency


def get_income_accounts(item_code):
	"""Optimized income account getter with caching"""
	global _cached_item_accounts

	if item_code not in _cached_item_accounts:
		try:
			pos_profile = get_current_pos_profile()
			company = pos_profile.company

			# Cache company data
			if company not in _cached_company_data:
				_cached_company_data[company] = frappe.get_doc("Company", company)

			company_doc = _cached_company_data[company]
			_cached_item_accounts[item_code] = company_doc.default_income_account
		except Exception as e:
			frappe.log_error(
				f"Error fetching income account for {item_code}: {e!s}",
				"Income Account Error",
			)
			_cached_item_accounts[item_code] = None

	return _cached_item_accounts[item_code]


def get_expense_accounts(item_code):
	"""Optimized expense account getter with caching"""
	global _cached_item_accounts

	cache_key = f"{item_code}_expense"
	if cache_key not in _cached_item_accounts:
		try:
			pos_profile = get_current_pos_profile()
			company = pos_profile.company

			# Cache company data
			if company not in _cached_company_data:
				_cached_company_data[company] = frappe.get_doc("Company", company)

			company_doc = _cached_company_data[company]
			_cached_item_accounts[cache_key] = company_doc.default_expense_account
		except Exception as e:
			frappe.log_error(
				f"Error fetching expense account for {item_code}: {e!s}",
				"Expense Account Error",
			)
			_cached_item_accounts[cache_key] = None

	return _cached_item_accounts[cache_key]


from frappe.model.mapper import get_mapped_doc


def validate_return_restrictions(invoice_doc):
	"""
	Validate if an invoice can be returned based on:
	1. Item Group custom_non_returnable field
	2. Item custom_is_refrigerated_ field (after 14 days)

	Args:
		invoice_doc: Sales Invoice document (original invoice if this is a return)

	Returns:
		tuple: (can_return: bool, error_message: str)
	"""
	if not invoice_doc or not invoice_doc.items:
		return True, None

	original_invoice = invoice_doc
	if invoice_doc.is_return and invoice_doc.return_against:
		try:
			original_invoice = frappe.get_doc("Sales Invoice", invoice_doc.return_against)
		except Exception:
			original_invoice = invoice_doc

	invoice_date_raw = original_invoice.posting_date or original_invoice.creation

	invoice_date = None
	try:
		if invoice_date_raw:
			invoice_date = frappe.utils.getdate(invoice_date_raw)
			if not isinstance(invoice_date, date_type):
				invoice_date = frappe.utils.getdate(str(invoice_date_raw))
	except Exception:
		pass

	if not invoice_date or not isinstance(invoice_date, date_type):
		invoice_date = frappe.utils.today()
		if not isinstance(invoice_date, date_type):
			from datetime import datetime
			try:
				if isinstance(invoice_date, str):
					invoice_date = datetime.strptime(invoice_date, "%Y-%m-%d").date()
				else:
					invoice_date = frappe.utils.today()
			except Exception:
				invoice_date = frappe.utils.today()

	today_date = frappe.utils.today()
	if not isinstance(today_date, date_type):
		today_date = frappe.utils.getdate(today_date)

	# Now safe to subtract
	days_since_invoice = (today_date - invoice_date).days

	# NEW RULE: All invoices older than 14 days cannot be returned
	if days_since_invoice > 14:
		return False, f"Cannot return this invoice. Invoice is {days_since_invoice} days old. Returns are only allowed within 14 days of the invoice date."

	# For invoices <= 14 days, check item/group restrictions
	non_returnable_items = []
	refrigerated_items = []

	for item in original_invoice.items:
		item_code = item.item_code

		# Check Item Group non-returnable flag
		if item.item_group:
			try:
				item_group_doc = frappe.get_doc("Item Group", item.item_group)
				if getattr(item_group_doc, "custom_non_returnable", 0):
					non_returnable_items.append(f"{item_code} ({item.item_name or item_code})")
			except Exception:
				pass

		# Check Item refrigerated flag (no age restriction needed here since we already checked invoice age)
		try:
			item_doc = frappe.get_doc("Item", item_code)
			if getattr(item_doc, "custom_is_refrigerated_", 0):
				refrigerated_items.append(f"{item_code} ({item.item_name or item_code})")
		except Exception:
			pass

	error_parts = []
	if non_returnable_items:
		error_parts.append(f"Items from non-returnable groups: {', '.join(non_returnable_items[:3])}")
		if len(non_returnable_items) > 3:
			error_parts[-1] += f" and {len(non_returnable_items) - 3} more"

	if refrigerated_items:
		error_parts.append(f"Refrigerated items: {', '.join(refrigerated_items[:3])}")
		if len(refrigerated_items) > 3:
			error_parts[-1] += f" and {len(refrigerated_items) - 3} more"

	if error_parts:
		error_message = "Cannot return this invoice. " + ". ".join(error_parts) + "."
		return False, error_message

	return True, None


def finalize_paid_amount(doc, method=None):
	"""
	Hook called on Sales Invoice on_submit.
	Can be used to sync or finalize paid_amount/outstanding for POS invoices.
	"""
	pass


def validate_sales_invoice_return(doc, method):
	"""
	Validate return restrictions before saving a Sales Invoice.
	This hook is called on validate for Sales Invoice documents.
	"""
	if doc.doctype != "Sales Invoice":
		return

	# Only validate if this is a return invoice
	if not doc.is_return:
		return

	# Skip validation for draft documents (they haven't been submitted yet)
	if doc.docstatus == 0:
		return

	can_return, error_message = validate_return_restrictions(doc)
	if not can_return:
		frappe.throw(_(error_message))


def ensure_negative_payments_for_pos_return(doc, method):
	"""
	ERPNext enforces that POS return invoices must have negative payment row amounts
	(via Sales Invoice.verify_payment_amount_is_negative()).

	App `validate` hooks run *after* ERPNext's validate, so this must run in
	`before_validate` to normalize signs before ERPNext checks them.
	"""
	if doc.doctype != "Sales Invoice":
		return
	if not getattr(doc, "is_return", 0):
		return
	if not getattr(doc, "is_pos", 0):
		return

	for p in doc.get("payments", []):
		try:
			amt = flt(getattr(p, "amount", 0) or 0)
		except Exception:
			amt = 0
		if amt > 0:
			p.amount = -abs(amt)

	# Keep paid amounts consistent for return sign convention
	try:
		if flt(getattr(doc, "paid_amount", 0) or 0) > 0:
			doc.paid_amount = -abs(flt(doc.paid_amount or 0))
	except Exception:
		pass
	try:
		if flt(getattr(doc, "base_paid_amount", 0) or 0) > 0:
			doc.base_paid_amount = -abs(flt(doc.base_paid_amount or 0))
	except Exception:
		pass


@frappe.whitelist()
def return_sales_invoice(invoice_name):
	try:
		original_invoice = frappe.get_doc("Sales Invoice", invoice_name)

		if original_invoice.docstatus != 1:
			frappe.throw("Only submitted invoices can be returned.")

		if original_invoice.is_return:
			frappe.throw("This invoice is already a return.")

		# Validate return restrictions
		can_return, error_message = validate_return_restrictions(original_invoice)
		if not can_return:
			frappe.throw(error_message)

		# Exclude payment mapping
		return_doc = get_mapped_doc(
			"Sales Invoice",
			invoice_name,
			{
				"Sales Invoice": {
					"doctype": "Sales Invoice",
					"field_map": {"name": "return_against"},
					"validation": {"docstatus": ["=", 1]},
				},
				"Sales Invoice Item": {
					"doctype": "Sales Invoice Item",
					"field_map": {"name": "prevdoc_detail_docname"},
				},
			},
		)

		return_doc.is_return = 1
		return_doc.posting_date = frappe.utils.nowdate()

		# Important: do not carry over original tax rows into the return.
		# Taxes must be recalculated based on the return's items (and our free-item tax hook).
		return_doc.set("taxes", [])
		return_doc.taxes_and_charges = None

		for item in return_doc.items:
			item.qty = -abs(item.qty)

		# Mirror original round-off/write-off as POSITIVE on return; totals logic handles sign for returns
		try:
			if getattr(original_invoice, "custom_roundoff_amount", 0):
				return_doc.custom_roundoff_amount = abs(original_invoice.custom_roundoff_amount or 0)
				return_doc.custom_base_roundoff_amount = abs(
					getattr(original_invoice, "custom_base_roundoff_amount", 0) or 0
				)
				# keep same account
				return_doc.custom_roundoff_account = getattr(
					original_invoice, "custom_roundoff_account", None
				)
				# Do not set standard write_off fields on returns to avoid double impact in GL
		except Exception:
			# non-fatal; continue without custom roundoff
			pass

		return_doc.payments = []
		for p in original_invoice.payments:
			return_doc.append(
				"payments",
				{
					"mode_of_payment": p.mode_of_payment,
					"amount": -abs(p.amount),
					"account": p.account,
				},
			)

		# Payment sync will be handled after save so totals include write-off adjustments

		return_doc.save(ignore_permissions=True)

		# After save (totals finalized by validate), sync payments to match grand/rounded total
		if getattr(return_doc, "custom_roundoff_amount", 0):
			try:
				return_doc.reload()
			except Exception:
				pass
			final_total = getattr(return_doc, "rounded_total", None)
			if final_total is None:
				final_total = return_doc.grand_total
			desired_payment = abs(flt(final_total, return_doc.precision("grand_total")))
			if desired_payment > 0:
				if return_doc.payments and len(return_doc.payments) > 0:
					# For returns, ERPNext requires payment table amounts to be negative
					# (verify_payment_amount_is_negative). Store refund as negative.
					return_doc.payments[0].amount = -desired_payment
					for _p in return_doc.payments[1:]:
						_p.amount = 0
				else:
					return_doc.append(
						"payments",
						{"mode_of_payment": "Cash", "amount": -desired_payment},
					)
			# Sync totals: for return, paid_amount is negative (refund given)
			return_doc.paid_amount = -desired_payment
			return_doc.base_paid_amount = -desired_payment * (return_doc.conversion_rate or 1)
			return_doc.outstanding_amount = 0
			return_doc.save(ignore_permissions=True)

		return_doc.submit()

		return {"success": True, "return_invoice": return_doc.name}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Return Invoice Error")
		return {"success": False, "message": str(e)}


# Add this function to handle round-off amount calculation and write-off
def set_base_roundoff_amount(doc, method):
	"""Set base round-off amount based on conversion rate"""
	if not doc.custom_roundoff_amount:
		return
	if not doc.conversion_rate:
		frappe.throw(_("Please set Exchange Rate First"))
	doc.custom_base_roundoff_amount = doc.conversion_rate * doc.custom_roundoff_amount


def set_grand_total_with_roundoff(doc, method):
	"""Modify grand total calculation to include round-off amount"""
	from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals

	if not doc.doctype == "Sales Invoice":
		return
	if not doc.custom_roundoff_account or not doc.custom_roundoff_amount:
		return

	# Monkey Patch calculate_totals method to include round-off
	calculate_taxes_and_totals.calculate_totals = custom_calculate_totals



def enforce_zero_rate_for_free_items(doc, method):
	"""
	Final safety net before save/submit:
	- Any Sales Invoice Item marked as is_free_item must have zero rate / amount.
	- This prevents any later pricing logic from restoring the original rate.
	"""
	if doc.doctype != "Sales Invoice":
		return

	for item in doc.get("items", []):
		if not getattr(item, "is_free_item", 0):
			continue

		# Hard enforce zero pricing for free lines
		item.rate = 0
		item.price_list_rate = 0
		item.base_rate = 0
		item.base_price_list_rate = 0
		item.discount_percentage = 0
		item.discount_amount = 0
		item.net_rate = 0
		item.amount = 0
		item.net_amount = 0
		item.allow_zero_valuation_rate = 1


def set_total_taxes_for_item_template(doc, method):
	"""
	When using item tax template mode (POS Profile.custom_allow_item_tax_template),
	ensure Sales Invoice.total_taxes_and_charges reflects the actual tax amount,
	even if no Sales Taxes and Charges Template / taxes rows are set.

	Creates separate tax rows for each unique item tax template to show individual
	tax calculations per template.
	"""

	# Only adjust Sales Invoices
	if doc.doctype != "Sales Invoice":
		return

	# If ERPNext has already populated taxes or a non-zero total_taxes_and_charges, do nothing
	# if doc.get("taxes") or (doc.total_taxes_and_charges or 0):
	# 	return

	# Check if current POS profile is in item tax template mode
	pos_profile = None
	try:
		if doc.pos_profile:
			pos_profile = frappe.get_cached_doc("POS Profile", doc.pos_profile)
		else:
			pos_profile = get_current_pos_profile()
	except Exception:
		pos_profile = None

	if not pos_profile or not getattr(pos_profile, "custom_allow_item_tax_template", 0):
		return

	net_total = doc.net_total or 0
	grand_total = doc.grand_total or 0

	# If custom round-off is applied, add it back to isolate the pure tax portion
	if getattr(doc, "custom_roundoff_amount", 0):
		grand_total += doc.custom_roundoff_amount or 0

	tax_amount = grand_total - net_total
	# Base tax amount from ERPNext (before adding tax on free items)
	base_tax_amount = flt(tax_amount, doc.precision("total_taxes_and_charges") or 2)
	# Populate the Sales Taxes and Charges table with per-template totals
	# Important: this runs *after* calculate_taxes_and_totals, so these rows are
	# informational only and will not change the already-computed totals.
	# if doc.get("taxes"):
	# 	# If taxes already exist, don't touch them
	# 	return

	# Aggregate tax per template - keep templates separate
	template_cache = {}
	template_totals = {}  # Track calculations per template
	is_return = 1 if getattr(doc, "is_return", 0) else 0

	for item in doc.get("items", []):
		item_template = getattr(item, "item_tax_template", None)
		if not item_template:
			continue

		if item_template not in template_cache:
			template_cache[item_template] = get_item_tax_template(item_template)
		tax_doc = template_cache[item_template]
		if not tax_doc:
			continue

		# Base amount for this item (the amount tax is calculated on).
		# For returns, item amount/net_amount can still be positive when built from mapped doc
		# (only qty is flipped). Force tax base to match net_total sign so tax is negative on returns.
		item_base = getattr(item, "net_amount", None) or getattr(item, "base_net_amount", None) or item.amount or 0
		item_base = flt(item_base or 0)
		if is_return and item_base > 0:
			item_base = -abs(item_base)
		if not item_base:
			continue

		# Initialize template tracking
		if item_template not in template_totals:
			template_totals[item_template] = {
				'base_amount': 0,
				'tax_rows': {}
			}

		template_totals[item_template]['base_amount'] += item_base

		# Item Tax Template has child table "taxes" with fields:
		# - tax_type (Link to Account)
		# - tax_rate (percentage)

		for tax_row in tax_doc.taxes:

			# Get the tax account and rate from Item Tax Template structure
			tax_account = tax_row.tax_type  # This is the account head
			tax_rate = tax_row.tax_rate or 0

			if not tax_account:
				continue

			# Create unique key for this tax row within this template
			row_key = tax_account  # Item Tax Template doesn't have cost center per row

			if row_key not in template_totals[item_template]['tax_rows']:
				template_totals[item_template]['tax_rows'][row_key] = {
					'account_head': tax_account,
					'rate': tax_rate,
					'tax_amount': 0
				}

			# Calculate tax for this item
			row_tax = (item_base * tax_rate) / 100.0
			template_totals[item_template]['tax_rows'][row_key]['tax_amount'] += row_tax

	# Default cost center fallback
	default_cc = frappe.db.get_value("Company", doc.company, "cost_center")

	# Create tax rows - one set per template, and accumulate the total tax
	total_tax = 0.0
	for template_name, template_data in template_totals.items():
		for row_key, row_data in template_data['tax_rows'].items():
			# Add to numeric total (per-template tax based on actual billed amounts)
			total_tax += row_data['tax_amount']

			# Create description that shows which template this is from
			# Include the tax rate to make it clearer
			description = f"{template_name} ({row_data['rate']}%)"

			tax_amt = flt(row_data['tax_amount'], doc.precision("total_taxes_and_charges") or 2)
			base_tax_amt = flt(tax_amt * (doc.conversion_rate or 1), doc.precision("base_total_taxes_and_charges") or 2)
			doc.append(
				"taxes",
				{
					"charge_type": "On Net Total",
					"account_head": row_data['account_head'],
					"description": description,
					"cost_center": doc.cost_center or default_cc,
					"tax_amount": tax_amt,
					"base_tax_amount": base_tax_amt,
					"tax_amount_after_discount_amount": tax_amt,
					"base_tax_amount_after_discount_amount": base_tax_amt,
					"category": "Total",
					"add_deduct_tax": "Add",
					"included_in_print_rate": 0,
				},
			)

	# ------------------------------------------------------------------
	# NEW LOGIC: Add tax on free items (is_free_item=1) as Actual rows.
	#
	# Requirement:
	# - When an item is given for free (rate 0, is_free_item=1), hospital
	#   still wants to charge the tax that would normally apply on that
	#   item's selling rate using its Item Tax Template.
	# - This extra tax should be visible in Sales Taxes and Charges as
	#   separate Actual rows and included in total_taxes_and_charges.
	# - On returns (is_return=1), item qty is negative; we still add
	#   "Tax on free items" rows with negative amounts so GL debits/credits balance.
	# ------------------------------------------------------------------
	free_item_tax_by_account = {}
	is_return = 1 if getattr(doc, "is_return", 0) else 0

	for item in doc.get("items", []):
		try:
			if not getattr(item, "is_free_item", 0):
				continue

			# Use line template if set; otherwise get default from Item / Item Group (e.g. when frontend sends none)
			item_template = getattr(item, "item_tax_template", None)
			if not item_template:
				from klik_pos.api import tax as tax_api
				res = tax_api.get_item_tax_template_for_item(item.item_code, doc.company)
				if res and res.get("item_tax_template"):
					item_template = res["item_tax_template"]
			if not item_template:
				continue

			tax_doc = get_item_tax_template(item_template)
			if not tax_doc or not getattr(tax_doc, "taxes", None):
				continue

			item_code = item.item_code
			free_base_rate = 0.0

			# UOM-aware base rate:
			# - If free item UOM differs from stock UOM, use the price for that UOM
			#   (or derive it via conversion factor), exactly like normal UOM pricing.
			item_uom = getattr(item, "uom", None)
			price_list = getattr(doc, "selling_price_list", None)
			if not price_list and getattr(doc, "pos_profile", None):
				price_list = frappe.db.get_value(
					"POS Profile", doc.pos_profile, "selling_price_list"
				)

			try:
				stock_uom, standard_rate = frappe.db.get_value(
					"Item", item_code, ["stock_uom", "standard_rate"]
				) or (None, 0)
			except Exception:
				stock_uom, standard_rate = (None, 0)

			standard_rate = flt(standard_rate or 0)

			try:
				# 1) If we know the item's UOM on the invoice, prefer a price for that UOM
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
						# Retry without price list restriction
						item_price_filters.pop("price_list", None)
						price_doc = frappe.get_value(
							"Item Price",
							item_price_filters,
							"price_list_rate",
						)

					if price_doc:
						free_base_rate = flt(price_doc or 0)

				# 2) If still no rate and UOM != stock_uom, derive from stock_uom via conversion factor
				if free_base_rate <= 0 and item_uom and stock_uom and item_uom != stock_uom:
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
						# Prefer standard_rate if available; otherwise use stock_uom Item Price
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
							free_base_rate = base_stock_rate * conv

				# 3) Final fallback: standard_rate (typical selling rate)
				if free_base_rate <= 0 and standard_rate > 0:
					free_base_rate = standard_rate

				# 4) Last resort: any Item Price in POS price list (no UOM filter)
				if free_base_rate <= 0 and price_list:
					any_price = frappe.db.get_value(
						"Item Price",
						{"item_code": item_code, "price_list": price_list},
						"price_list_rate",
					)
					free_base_rate = flt(any_price or 0)
			except Exception:
				free_base_rate = flt(standard_rate or 0)

			if free_base_rate <= 0:
				# No sensible base rate available; skip this free item
				continue

			# For returns, qty is negative; use abs(qty) for tax base and apply sign when aggregating
			item_qty = flt(getattr(item, "qty", 0))
			if item_qty == 0:
				continue
			item_qty_for_tax = abs(item_qty)
			sign = -1 if is_return else 1

			for tax_row in tax_doc.taxes:
				tax_account = tax_row.tax_type
				tax_rate = flt(tax_row.tax_rate or 0)
				if not tax_account or tax_rate == 0:
					continue

				# Tax is calculated on the "normal" selling value of the free item
				item_tax_base = free_base_rate * item_qty_for_tax
				free_tax_amount = (item_tax_base * tax_rate) / 100.0 * sign
				if free_tax_amount == 0:
					continue

				if tax_account not in free_item_tax_by_account:
					free_item_tax_by_account[tax_account] = 0.0
				free_item_tax_by_account[tax_account] += free_tax_amount
		except Exception:
			# Never block invoice creation because of free-item tax issues
			frappe.log_error(
				frappe.get_traceback(),
				"Error calculating tax for free item on Sales Invoice",
			)
			continue

	# Append Actual tax rows for free-item tax and include in totals
	# For returns, amount can be negative (reversal of tax on free items).
	free_items_total_tax = 0.0
	if free_item_tax_by_account:
		for account_head, amount in free_item_tax_by_account.items():
			if amount == 0:
				continue

			free_items_total_tax += amount
			tax_amt = flt(amount, doc.precision("total_taxes_and_charges") or 2)
			base_tax_amt = flt(amount * (doc.conversion_rate or 1), doc.precision("base_total_taxes_and_charges") or 2)
			doc.append(
				"taxes",
				{
					"charge_type": "Actual",
					"account_head": account_head,
					"description": "Tax on free items",
					"cost_center": doc.cost_center or default_cc,
					"tax_amount": tax_amt,
					"base_tax_amount": base_tax_amt,
					"tax_amount_after_discount_amount": tax_amt,
					"base_tax_amount_after_discount_amount": base_tax_amt,
					"category": "Total",
					"add_deduct_tax": "Add",
					"included_in_print_rate": 0,
				},
			)

	# Final numeric totals = base tax (from ERPNext) + explicit per-template tax
	# breakdown (total_tax) + additional tax on free items.
	# For returns, total_tax_with_free can be negative; still update doc totals.
	total_tax_with_free = base_tax_amount + total_tax + free_items_total_tax
	if total_tax_with_free != 0:
		doc.total_taxes_and_charges = flt(
			total_tax_with_free, doc.precision("total_taxes_and_charges") or 2
		)
		doc.base_total_taxes_and_charges = flt(
			total_tax_with_free * (doc.conversion_rate or 1),
			doc.precision("base_total_taxes_and_charges") or 2,
		)

		# Ensure grand_total matches net_total + all taxes (UI behavior)
		net_total = flt(doc.net_total or 0, doc.precision("net_total") or 2)
		doc.grand_total = flt(
			net_total + doc.total_taxes_and_charges,
			doc.precision("grand_total") or 2,
		)
		doc.base_grand_total = flt(
			doc.grand_total * (doc.conversion_rate or 1),
			doc.precision("base_grand_total") or 2,
		)

def custom_calculate_totals(self):
	"""Main function to calculate invoice totals with custom round-off logic"""
	# Calculate basic grand total and taxes
	if self.doc.get("taxes"):
		# If hooks (like item tax template mode) already set total_taxes_and_charges,
		# keep that; otherwise, fall back to ERPNext-style computation from last tax row.
		if not self.doc.total_taxes_and_charges:
			last_total = flt(getattr(self.doc.get("taxes")[-1], "total", 0))
			self.doc.total_taxes_and_charges = flt(
				last_total - flt(self.doc.net_total) - flt(self.doc.get("grand_total_diff")),
				self.doc.precision("total_taxes_and_charges"),
			)
	else:
		self.doc.total_taxes_and_charges = 0.0

	# Grand total = net total + all taxes (including free-item tax) + any grand_total_diff
	self.doc.grand_total = flt(
		flt(self.doc.net_total)
		+ flt(self.doc.total_taxes_and_charges or 0)
		+ flt(self.doc.get("grand_total_diff")),
		self.doc.precision("grand_total"),
	)
	# Apply existing roundoff amount
	if (
		self.doc.doctype == "Sales Invoice"
		and self.doc.custom_roundoff_account
		and self.doc.custom_roundoff_amount
	):
		adjustment = self.doc.custom_roundoff_amount or 0

		# For returns, add the round-off to reduce the negative magnitude (e.g., -13 + 3.01 = -9.99)
		if getattr(self.doc, "is_return", 0):
			self.doc.grand_total += adjustment
		else:
			# Normal invoices subtract the round-off (e.g., 13 - 3.01 = 9.99)
			self.doc.grand_total -= adjustment

	self._set_in_company_currency(self.doc, ["total_taxes_and_charges", "rounding_adjustment"])
	# Calculate base currency totals
	if self.doc.doctype in [
		"Quotation",
		"Sales Order",
		"Delivery Note",
		"Sales Invoice",
		"POS Invoice",
	]:
		self.doc.base_grand_total = (
			flt(
				self.doc.grand_total * self.doc.conversion_rate,
				self.doc.precision("base_grand_total"),
			)
			if self.doc.total_taxes_and_charges
			else self.doc.base_net_total
		)
	else:
		self.doc.taxes_and_charges_added = self.doc.taxes_and_charges_deducted = 0.0
		for tax in self.doc.get("taxes"):
			if tax.category in ["Valuation and Total", "Total"]:
				if tax.add_deduct_tax == "Add":
					self.doc.taxes_and_charges_added += flt(tax.tax_amount_after_discount_amount)
				else:
					self.doc.taxes_and_charges_deducted += flt(tax.tax_amount_after_discount_amount)

		self.doc.round_floats_in(self.doc, ["taxes_and_charges_added", "taxes_and_charges_deducted"])

		self.doc.base_grand_total = (
			flt(self.doc.grand_total * self.doc.conversion_rate)
			if (self.doc.taxes_and_charges_added or self.doc.taxes_and_charges_deducted)
			else self.doc.base_net_total
		)

		self._set_in_company_currency(self.doc, ["taxes_and_charges_added", "taxes_and_charges_deducted"])

	self.doc.round_floats_in(self.doc, ["grand_total", "base_grand_total"])
	# Mania: Auto write-off small decimal amounts (e.g., 10.01 -> 10.00, -50.01 -> -50.00)
	if self.doc.doctype == "Sales Invoice":
		if self.doc.grand_total > 0:
			grand_total_int = int(self.doc.grand_total)
			# Float-safe fractional part (handles cases like 100.0100000001)
			decimal_part = flt(self.doc.grand_total - grand_total_int, 6)
			# If decimal part is very small (<= 0.01), write it off (with small tolerance)
			if decimal_part > 0 and decimal_part <= (0.01 + 1e-6):
				writeoff_account = get_writeoff_account()
				if writeoff_account:
					small_amount = decimal_part
					if self.doc.custom_roundoff_amount:
						self.doc.custom_roundoff_amount += small_amount
					else:
						self.doc.custom_roundoff_amount = small_amount
					self.doc.custom_roundoff_account = writeoff_account
					self.doc.custom_base_roundoff_amount = self.doc.custom_roundoff_amount * (
						self.doc.conversion_rate or 1
					)
					# For positive totals, subtract to reach .00
					self.doc.grand_total -= small_amount
					self.doc.base_grand_total = self.doc.grand_total * (self.doc.conversion_rate or 1)
		elif self.doc.grand_total < 0:
			abs_total = abs(self.doc.grand_total)
			abs_int = int(abs_total)
			decimal_part = flt(abs_total - abs_int, 6)
			if decimal_part > 0 and decimal_part <= (0.01 + 1e-6):
				writeoff_account = get_writeoff_account()
				if writeoff_account:
					small_amount = decimal_part
					if self.doc.custom_roundoff_amount:
						self.doc.custom_roundoff_amount += small_amount
					else:
						self.doc.custom_roundoff_amount = small_amount
					self.doc.custom_roundoff_account = writeoff_account
					self.doc.custom_base_roundoff_amount = self.doc.custom_roundoff_amount * (
						self.doc.conversion_rate or 1
					)
					# For negative totals, add to reach .00 (e.g., -50.01 + 0.01 = -50)
					self.doc.grand_total += small_amount
					self.doc.base_grand_total = self.doc.grand_total * (self.doc.conversion_rate or 1)
	# print("Round-off amount before adjustment:", self.doc.custom_roundoff_amount)

	self.set_rounded_total()


def create_roundoff_writeoff_entry(self):
	"""Create a write-off entry for round-off amount"""
	if not self.doc.custom_roundoff_amount or not self.doc.custom_roundoff_account:
		return
	if self.doc.is_return:
		write_off_amount = -self.doc.custom_roundoff_amount
	else:
		write_off_amount = self.doc.custom_roundoff_amount

	roundoff_entry = {
		"charge_type": "Actual",
		"account_head": self.doc.custom_roundoff_account,
		"description": "Round Off Adjustment",
		"tax_amount": write_off_amount,
		"base_tax_amount": write_off_amount or (write_off_amount * self.doc.conversion_rate),
		"add_deduct_tax": "Add" if write_off_amount > 0 else "Deduct",
		"category": "Total",
		"included_in_print_rate": 0,
		"cost_center": self.doc.cost_center
		or frappe.get_cached_value("Company", self.doc.company, "cost_center"),
	}

	self.doc.append("taxes", roundoff_entry)


def get_writeoff_account():
	pos_profile = get_current_pos_profile()
	if pos_profile.write_off_account:
		return pos_profile.write_off_account


class CustomSalesInvoice(SalesInvoice):
	def set_pos_fields(self, for_validate=False):
		"""When item tax template mode is enabled, remove any document-level
		Sales Taxes and Charges so we don't mix template tax with per-item
		item_tax_template tax.

		The per-item taxes are then reflected by set_total_taxes_for_item_template,
		which rebuilds the taxes table from the item_tax_template values.
		"""

		pos = super().set_pos_fields(for_validate)
		if pos and getattr(pos, "custom_allow_item_tax_template", 0):
			self.taxes_and_charges = None
			# Also clear any existing taxes rows that might have been added
			# from a Sales Taxes and Charges Template or other logic so that
			# set_total_taxes_for_item_template can rebuild them cleanly
			# from item_tax_template per item.
			self.taxes = []
		# frappe.throw(str(self.taxes))
		return pos

	def get_gl_entries(self, warehouse_account=None):
		from erpnext.accounts.general_ledger import merge_similar_entries

		gl_entries = []

		self.make_roundoff_gl_entry(gl_entries)

		self.make_customer_gl_entry(gl_entries)

		self.make_tax_gl_entries(gl_entries)
		self.make_internal_transfer_gl_entries(gl_entries)

		self.make_item_gl_entries(gl_entries)
		self.make_precision_loss_gl_entry(gl_entries)
		self.make_discount_gl_entries(gl_entries)

		gl_entries = make_regional_gl_entries(gl_entries, self)

		# merge gl entries before adding pos entries
		gl_entries = merge_similar_entries(gl_entries)

		self.make_loyalty_point_redemption_gle(gl_entries)
		self.make_pos_gl_entries(gl_entries)

		self.make_write_off_gl_entry(gl_entries)
		self.make_gle_for_rounding_adjustment(gl_entries)

		return gl_entries

	def make_roundoff_gl_entry(self, gl_entries):
		if self.custom_roundoff_account and self.custom_roundoff_amount:
			against_voucher = self.name
			# For return invoices, reverse the GL impact (credit instead of debit)
			if getattr(self, "is_return", 0):
				gl_entries.append(
					self.get_gl_dict(
						{
							"account": self.custom_roundoff_account,
							"party_type": "Customer",
							"party": self.customer,
							"due_date": self.due_date,
							"against": against_voucher,
							"credit": self.custom_base_roundoff_amount,
							"credit_in_account_currency": (
								self.custom_base_roundoff_amount
								if self.party_account_currency == self.company_currency
								else self.custom_roundoff_amount
							),
							"against_voucher": against_voucher,
							"against_voucher_type": self.doctype,
							"cost_center": (
								self.cost_center
								if self.cost_center
								else "Main - " + frappe.db.get_value("Company", self.company, "abbr")
							),
							"project": self.project,
						},
						self.party_account_currency,
						item=self,
					)
				)
			else:
				gl_entries.append(
					self.get_gl_dict(
						{
							"account": self.custom_roundoff_account,
							"party_type": "Customer",
							"party": self.customer,
							"due_date": self.due_date,
							"against": against_voucher,
							"debit": self.custom_base_roundoff_amount,
							"debit_in_account_currency": (
								self.custom_base_roundoff_amount
								if self.party_account_currency == self.company_currency
								else self.custom_roundoff_amount
							),
							"against_voucher": against_voucher,
							"against_voucher_type": self.doctype,
							"cost_center": (
								self.cost_center
								if self.cost_center
								else "Main - " + frappe.db.get_value("Company", self.company, "abbr")
							),
							"project": self.project,
						},
						self.party_account_currency,
						item=self,
					)
				)


@erpnext.allow_regional
def make_regional_gl_entries(gl_entries, doc):
	return gl_entries


def create_payment_entry(sales_invoice, mode_of_payment, amount_paid):
	"""
	Create Payment Entry for B2B Sales Invoice
	"""
	try:
		# Get company and customer details
		company = sales_invoice.company
		customer = sales_invoice.customer

		# Create Payment Entry
		payment_entry = frappe.new_doc("Payment Entry")
		payment_entry.payment_type = "Receive"
		payment_entry.party_type = "Customer"
		payment_entry.party = customer
		payment_entry.company = company
		payment_entry.posting_date = frappe.utils.nowdate()

		# Set paid amount
		payment_entry.paid_amount = amount_paid
		payment_entry.received_amount = amount_paid
		payment_entry.source_exchange_rate = 1
		payment_entry.target_exchange_rate = 1

		company_doc = frappe.get_doc("Company", company)

		payment_entry.party_account = get_customer_receivable_account(customer, company)

		# Handle multiple payment methods
		if isinstance(mode_of_payment, list) and len(mode_of_payment) > 0:
			first_payment = mode_of_payment[0]
			mode_of_payment_doc = frappe.get_doc("Mode of Payment", first_payment["method"])

			for account in mode_of_payment_doc.accounts:
				if account.company == company:
					payment_entry.paid_to = account.default_account
					break

			if not payment_entry.paid_to:
				payment_entry.paid_to = company_doc.default_cash_account

			payment_entry.mode_of_payment = first_payment["method"]

			payment_entry.append(
				"references",
				{
					"reference_doctype": "Sales Invoice",
					"reference_name": sales_invoice.name,
					"allocated_amount": amount_paid,
				},
			)

		else:
			payment_entry.paid_to = company_doc.default_cash_account
			payment_entry.mode_of_payment = "Cash"

			payment_entry.append(
				"references",
				{
					"reference_doctype": "Sales Invoice",
					"reference_name": sales_invoice.name,
					"allocated_amount": amount_paid,
				},
			)

		payment_entry.paid_from_account_currency = sales_invoice.currency
		payment_entry.paid_to_account_currency = sales_invoice.currency

		payment_entry.save()
		payment_entry.submit()

		return payment_entry

	except Exception as e:
		frappe.log_error(
			frappe.get_traceback(),
			f"Error creating payment entry for invoice {sales_invoice.name}",
		)
		frappe.throw(f"Failed to create payment entry: {e!s}")


def get_customer_receivable_account(customer, company):
	"""Get customer's receivable account using ERPNext utility"""
	try:
		from erpnext.accounts.party import get_party_account

		return get_party_account("Customer", customer, company)
	except Exception as e:
		frappe.log_error(f"Error getting receivable account for customer {customer}: {e!s}")
		return frappe.db.get_value("Company", company, "default_receivable_account")


@frappe.whitelist()
def returned_qty(customer, sales_invoice, item):
	"""
	Get total returned quantity for a specific item (item_code) against a given sales invoice.
	- sales_invoice should be the original invoice name.
	- item should be the item_code (not item name or child row name).
	Returns: {'total_returned_qty': <float>}
	"""
	values = {
		"customer": customer,
		"sales_invoice": sales_invoice,
		"item": item,
	}

	# Sum qty from Sales Invoice Items of return invoices that point to the original invoice
	result = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(sii.qty), 0) AS total_returned_qty
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
		WHERE si.is_return = 1
		  AND si.return_against = %(sales_invoice)s
		  AND sii.item_code = %(item)s
		  AND si.docstatus = 1
		  AND si.customer = %(customer)s
		""",
		values=values,
		as_dict=True,
	)

	total = abs(result[0]["total_returned_qty"]) if result else 0.0
	return {
		"total_returned_qty": round(float(total), 6)
	}  # Round to 6 decimal places to avoid precision issues


@frappe.whitelist()
def get_valid_sales_invoices(doctype, txt, searchfield, start, page_len, filters=None):
	"""Get valid sales invoices based on filters for multi-invoice returns"""
	filters = filters or {}

	customer = filters.get("customer")
	shipping_address = filters.get("shipping_address")
	item_code = filters.get("item_code")
	start_date = filters.get("start_date")

	if not customer or not item_code or not start_date:
		return []

	# Build dynamic conditions
	conditions = [
		"si.docstatus = 1",
		"si.is_return = 0",
		"si.custom_pos_opening_entry IS NOT NULL AND si.custom_pos_opening_entry != ''",
	]
	query_params = {
		"txt": f"%{txt}%",
		"start": start,
		"page_len": page_len,
	}

	if customer:
		conditions.append("si.customer = %(customer)s")
		query_params["customer"] = customer

	if shipping_address:
		conditions.append("si.shipping_address_name = %(shipping_address)s")
		query_params["shipping_address"] = shipping_address

	if item_code:
		conditions.append("sii.item_code = %(item_code)s")
		query_params["item_code"] = item_code

	if start_date:
		conditions.append("si.posting_date >= %(start_date)s")
		query_params["start_date"] = start_date

	conditions.append(
		"""
		(sii.qty + COALESCE((
			SELECT SUM(cd.qtr)
			FROM `tabCredit Details` cd
			JOIN `tabSales Invoice` rsi ON cd.parent = rsi.name
			WHERE cd.sales_invoice = si.name
			AND cd.item = sii.item_code
			AND rsi.customer = si.customer
			AND rsi.docstatus = 1
			AND rsi.status != 'Cancelled'
		), 0)) > 0
	"""
	)

	where_clause = " AND ".join(conditions)
	query = f"""
		SELECT DISTINCT si.name,si.posting_date,sii.qty
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
		WHERE {where_clause}
		AND si.name LIKE %(txt)s
		LIMIT %(start)s, %(page_len)s
	"""

	return frappe.db.sql(query, query_params)


@frappe.whitelist()
def get_customer_invoices_for_return(customer, start_date=None, end_date=None, shipping_address=None):
	"""Get all invoices for a customer within date range that can be returned"""
	try:
		filters = {
			"customer": customer,
			"docstatus": 1,
			"is_return": 0,
			"status": ["!=", "Cancelled"],
			"custom_pos_opening_entry": ["!=", ""],
		}

		if start_date:
			filters["posting_date"] = [">=", start_date]
		if end_date:
			if "posting_date" in filters:
				filters["posting_date"] = ["between", [start_date, end_date]]
			else:
				filters["posting_date"] = ["<=", end_date]

		# Add shipping address filter if provided
		if shipping_address:
			filters["customer_address"] = shipping_address

		invoices = frappe.get_all(
			"Sales Invoice",
			filters=filters,
			fields=[
				"name",
				"posting_date",
				"posting_time",
				"customer",
				"grand_total",
				"paid_amount",
				"status",
			],
			order_by="posting_date desc",
		)

		# Batch fetch all items for all invoices
		invoice_names = [inv.name for inv in invoices]
		all_items = []
		if invoice_names:
			all_items = frappe.get_all(
				"Sales Invoice Item",
				filters={"parent": ["in", invoice_names]},
				fields=["parent", "item_code", "item_name", "qty", "rate", "amount"],
				order_by="parent, idx",
			)

		# Batch fetch all returned quantities for all items at once
		returned_qty_map = {}
		if all_items:
			item_codes = list(set([item.item_code for item in all_items]))
			_invoice_item_pairs = [(item.parent, item.item_code) for item in all_items]

			if item_codes:
				# Create a more efficient query to get all returned quantities
				returns_query = """
					SELECT
						rsi.return_against as original_invoice,
						sii.item_code,
						COALESCE(SUM(ABS(sii.qty)), 0) as total_returned_qty
					FROM `tabSales Invoice` rsi
					JOIN `tabSales Invoice Item` sii ON rsi.name = sii.parent
					WHERE rsi.is_return = 1
					  AND rsi.return_against IN ({})
					  AND sii.item_code IN ({})
					  AND rsi.docstatus = 1
					  AND rsi.customer = %s
					GROUP BY rsi.return_against, sii.item_code
				""".format(
					",".join([f"'{name}'" for name in invoice_names]),
					",".join([f"'{code}'" for code in item_codes]),
				)

				returns_data = frappe.db.sql(returns_query, (customer,), as_dict=True)
				returned_qty_map = {
					(row.original_invoice, row.item_code): row.total_returned_qty for row in returns_data
				}

		# Group items by invoice and calculate returned quantities
		invoice_items_map = {}
		for item in all_items:
			if item.parent not in invoice_items_map:
				invoice_items_map[item.parent] = []

			returned_qty_value = returned_qty_map.get((item.parent, item.item_code), 0)
			item.returned_qty = returned_qty_value
			item.available_qty = round(
				item.qty - returned_qty_value, 6
			)  # Round to 6 decimal places to avoid precision issues

			invoice_items_map[item.parent].append(item)

		# Assign items to invoices
		for invoice in invoices:
			invoice.items = invoice_items_map.get(invoice.name, [])

			# Get all payment methods from payment child table
			invoice_doc = frappe.get_doc("Sales Invoice", invoice.name)
			payment_methods = []
			if invoice_doc.payments:
				for payment in invoice_doc.payments:
					payment_methods.append(
						{"mode_of_payment": payment.mode_of_payment, "amount": payment.amount}
					)
			elif invoice_doc.status == "Draft":
				payment_methods = []
			else:
				# Check Payment Entry if invoice payments table is empty but invoice is paid
				if invoice_doc.status in ["Paid", "Partly Paid"] and not invoice_doc.payments:
					payment_entries = frappe.get_all(
						"Payment Entry Reference",
						filters={"reference_name": invoice_doc.name, "reference_doctype": "Sales Invoice"},
						fields=["parent", "allocated_amount"],
						parent_doctype="Payment Entry",
					)

					for pe_ref in payment_entries:
						payment_entry = frappe.get_doc("Payment Entry", pe_ref.parent)
						if payment_entry.docstatus == 1:
							payment_methods.append(
								{
									"mode_of_payment": payment_entry.mode_of_payment,
									"amount": pe_ref.allocated_amount,
								}
							)

			invoice.payment_methods = payment_methods
			# Keep backward compatibility - show first payment method or combined display
			if len(payment_methods) == 0:
				invoice.payment_method = "-"
			elif len(payment_methods) == 1:
				invoice.payment_method = payment_methods[0]["mode_of_payment"]
			else:
				# Show combined payment methods like "Cash/Credit Card"
				invoice.payment_method = "/".join([pm["mode_of_payment"] for pm in payment_methods])

		return {"success": True, "data": invoices}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching customer invoices for return")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def create_partial_return(
	invoice_name, return_items, payment_method=None, return_amount=None, expected_return_amount=None
):
	"""Create a partial return for selected items from an invoice with custom payment method"""

	try:
		if isinstance(return_items, str):
			return_items = json.loads(return_items)

		original_invoice = frappe.get_doc("Sales Invoice", invoice_name)

		if original_invoice.docstatus != 1:
			frappe.throw("Only submitted invoices can be returned.")

		if original_invoice.is_return:
			frappe.throw("This invoice is already a return.")

		# NEW RULE: Check if invoice is older than 14 days first
		invoice_date_raw = original_invoice.posting_date or original_invoice.creation
		invoice_date = None
		try:
			if invoice_date_raw:
				invoice_date = frappe.utils.getdate(invoice_date_raw)
				if not isinstance(invoice_date, date_type):
					invoice_date = frappe.utils.getdate(str(invoice_date_raw))
		except Exception:
			pass

		if not invoice_date or not isinstance(invoice_date, date_type):
			invoice_date = frappe.utils.today()
			if not isinstance(invoice_date, date_type):
				from datetime import datetime
				try:
					if isinstance(invoice_date, str):
						invoice_date = datetime.strptime(invoice_date, "%Y-%m-%d").date()
					else:
						invoice_date = frappe.utils.today()
				except Exception:
					invoice_date = frappe.utils.today()

		today_date = frappe.utils.today()
		if not isinstance(today_date, date_type):
			today_date = frappe.utils.getdate(today_date)

		days_since_invoice = (today_date - invoice_date).days

		# Block all returns if invoice is older than 14 days
		if days_since_invoice > 14:
			frappe.throw(f"Cannot return this invoice. Invoice is {days_since_invoice} days old. Returns are only allowed within 14 days of the invoice date.")

		# Validate return restrictions for items being returned (only for invoices <= 14 days)
		# Check if any of the return_items belong to non-returnable groups or are refrigerated
		if return_items:
			# Get item codes being returned
			return_item_codes = [item.get("item_code") for item in return_items if item.get("return_qty", 0) > 0]

			# Check each item being returned
			non_returnable_items = []
			refrigerated_items = []

			for item_code in return_item_codes:
				# Find the original item in the invoice
				original_item = None
				for inv_item in original_invoice.items:
					if inv_item.item_code == item_code:
						original_item = inv_item
						break

				if not original_item:
					continue

				# Check Item Group
				if original_item.item_group:
					try:
						item_group_doc = frappe.get_doc("Item Group", original_item.item_group)
						if getattr(item_group_doc, "custom_non_returnable", 0):
							non_returnable_items.append(f"{item_code} ({original_item.item_name or item_code})")
					except Exception:
						pass

				# Check refrigerated (no age restriction needed since we already checked invoice age)
				try:
					item_doc = frappe.get_doc("Item", item_code)
					if getattr(item_doc, "custom_is_refrigerated_", 0):
						refrigerated_items.append(f"{item_code} ({original_item.item_name or item_code})")
				except Exception:
					pass

			# Build error messages
			error_parts = []
			if non_returnable_items:
				error_parts.append(f"Items from non-returnable groups: {', '.join(non_returnable_items[:3])}")
				if len(non_returnable_items) > 3:
					error_parts[-1] += f" and {len(non_returnable_items) - 3} more"

			if refrigerated_items:
				error_parts.append(f"Refrigerated items: {', '.join(refrigerated_items[:3])}")
				if len(refrigerated_items) > 3:
					error_parts[-1] += f" and {len(refrigerated_items) - 3} more"

			if error_parts:
				error_message = "Cannot return selected items. " + ". ".join(error_parts) + "."
				frappe.throw(error_message)

		# Create return invoice using the same approach as return_sales_invoice
		return_doc = get_mapped_doc(
			"Sales Invoice",
			invoice_name,
			{
				"Sales Invoice": {
					"doctype": "Sales Invoice",
					"field_map": {"name": "return_against"},
					"validation": {"docstatus": ["=", 1]},
				},
				"Sales Invoice Item": {
					"doctype": "Sales Invoice Item",
					"field_map": {"name": "prevdoc_detail_docname"},
				},
			},
		)

		return_doc.is_return = 1
		return_doc.posting_date = frappe.utils.nowdate()
		return_doc.custom_delivery_date = frappe.utils.nowdate()

		# Important: do not carry over original tax rows into the partial return.
		# We'll recalculate taxes from the filtered returned items only.
		return_doc.set("taxes", [])
		return_doc.taxes_and_charges = None

		# Set the current POS opening entry
		current_opening_entry = get_current_pos_opening_entry()
		if current_opening_entry:
			return_doc.custom_pos_opening_entry = current_opening_entry

		# Ensure no original round-off leaks into partial return
		return_doc.custom_roundoff_amount = 0
		return_doc.custom_base_roundoff_amount = 0
		return_doc.custom_roundoff_account = get_writeoff_account()

		# Filter items to only include selected ones with return quantities
		filtered_items = []
		for return_item in return_items:
			if return_item.get("return_qty", 0) > 0:
				for item in return_doc.items:
					if item.item_code == return_item["item_code"]:
						item.qty = -abs(return_item["return_qty"])
						filtered_items.append(item)
						break

		return_doc.items = filtered_items

		# No custom roundoff mirroring for now

		# Clear existing payments
		return_doc.payments = []

		# Calculate total returned amount (baseline expected refund)
		# Prefer client-provided expected amount; fallback to backend computation
		if expected_return_amount is not None:
			try:
				total_returned_amount = flt(expected_return_amount, return_doc.precision("grand_total") or 2)
			except Exception:
				total_returned_amount = sum(abs(item.qty * item.rate) for item in return_doc.items)
		else:
			total_returned_amount = sum(abs(item.qty * item.rate) for item in return_doc.items)

		final_return_amount = return_amount if return_amount is not None else total_returned_amount

		final_payment_method = payment_method if payment_method else "Cash"

		# Optionally persist the auto-calculated expected refund if a custom field exists
		try:
			_si_meta = frappe.get_meta("Sales Invoice")
			if any(df.fieldname == "custom_expected_refund_amount" for df in _si_meta.fields):
				return_doc.custom_expected_refund_amount = flt(
					total_returned_amount, return_doc.precision("grand_total") or 2
				)
		except Exception:
			pass

		# If cashier entered a custom refund (partial return), push the difference to round-off on the return
		try:
			# Only apply when there's a meaningful difference
			prec = return_doc.precision("grand_total") or 2
			_diff = flt(total_returned_amount, prec) - flt(final_return_amount, prec)
			if abs(_diff) > (10 ** (-prec)) / 2:
				# For returns, custom_calculate_totals ADDS custom_roundoff_amount to grand_total.
				# This is a NEW write-off specific to this partial return. Do not accumulate.
				return_doc.custom_roundoff_amount = 0
				return_doc.custom_base_roundoff_amount = 0
				return_doc.custom_roundoff_amount = abs(flt(_diff, prec))
				return_doc.custom_roundoff_account = get_writeoff_account()
				return_doc.custom_base_roundoff_amount = flt(
					return_doc.custom_roundoff_amount * (return_doc.conversion_rate or 1), prec
				)
		except Exception:
			pass
		# Handle write-off for full returns
		original_grand_total = abs(original_invoice.grand_total)
		requested_return = abs(final_return_amount)
		is_full_return = abs(requested_return - original_grand_total) < 0.01

		if (
			is_full_return
			and hasattr(original_invoice, "custom_roundoff_amount")
			and original_invoice.custom_roundoff_amount
		):
			# For full returns, mirror the original write-off to make grand total = paid amount
			return_doc.custom_roundoff_amount = abs(original_invoice.custom_roundoff_amount)
			return_doc.custom_base_roundoff_amount = abs(original_invoice.custom_base_roundoff_amount)
			return_doc.custom_roundoff_account = getattr(
				original_invoice, "custom_roundoff_account", get_writeoff_account()
			)

			# Adjust payment amount to match the paid amount (after write-off)
			original_paid_amount = original_invoice.paid_amount or original_invoice.grand_total
			final_return_amount = abs(original_paid_amount)

		if final_return_amount > 0:
			return_doc.append(
				"payments",
				{
					"mode_of_payment": final_payment_method,
					"amount": -abs(final_return_amount),
				},
			)
		print("Mko 3", -abs(final_return_amount))
		# Recalculate totals (payment amount stays as user entered)
		try:
			return_doc.calculate_taxes_and_totals()
		except Exception:
			pass

		return_doc.save(ignore_permissions=True)
		return_doc.submit()

		return {
			"success": True,
			"return_invoice": return_doc.name,
			"message": f"Return created successfully: {return_doc.name} (Payment: {final_payment_method})",
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Partial Return Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def create_multi_invoice_return(return_data):
	"""Create multiple return invoices for items from different invoices"""
	try:
		if isinstance(return_data, str):
			return_data = json.loads(return_data)

		invoice_returns = return_data.get("invoice_returns", [])

		created_returns = []

		for _i, invoice_return in enumerate(invoice_returns):
			invoice_name = invoice_return.get("invoice_name")
			return_items = invoice_return.get("return_items", [])
			payment_method = invoice_return.get("payment_method")
			return_amount = invoice_return.get("return_amount")

			if return_items:
				# Call create_partial_return with payment method and return amount
				result = create_partial_return(
					invoice_name, return_items, payment_method=payment_method, return_amount=return_amount
				)
				if result.get("success"):
					created_returns.append(result.get("return_invoice"))
				else:
					frappe.log_error(f"Failed to create return for {invoice_name}: {result.get('message')}")

		return {
			"success": True,
			"created_returns": created_returns,
			"message": f"Created {len(created_returns)} return invoices successfully",
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Multi Invoice Return Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def delete_draft_invoice(invoice_id):
	"""
	Delete a draft sales invoice.
	Only allows deletion of Draft status invoices.
	"""
	try:
		# Get the invoice document
		invoice_doc = frappe.get_doc("Sales Invoice", invoice_id)

		if invoice_doc.status != "Draft":
			return {
				"success": False,
				"error": f"Cannot delete invoice {invoice_id}. Only Draft invoices can be deleted. Current status: {invoice_doc.status}",
			}

		invoice_doc.delete()

		return {
			"success": True,
			"message": f"Draft invoice {invoice_id} deleted successfully",
		}

	except frappe.DoesNotExistError:
		return {"success": False, "error": f"Invoice {invoice_id} not found"}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error deleting draft invoice {invoice_id}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def submit_draft_invoice(invoice_id):
	"""
	Submit a draft sales invoice directly without payment dialog.
	This converts a draft invoice to submitted status.
	"""
	try:
		invoice_doc = frappe.get_doc("Sales Invoice", invoice_id)

		if invoice_doc.status != "Draft":
			return {
				"success": False,
				"error": f"Cannot submit invoice {invoice_id}. Only Draft invoices can be submitted. Current status: {invoice_doc.status}",
			}

		invoice_doc.submit()

		return {
			"success": True,
			"message": f"Draft invoice {invoice_id} submitted successfully",
			"invoice_name": invoice_doc.name,
			"invoice": invoice_doc,
		}

	except frappe.DoesNotExistError:
		return {"success": False, "error": f"Invoice {invoice_id} not found"}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error submitting draft invoice {invoice_id}")
		return {"success": False, "error": str(e)}
