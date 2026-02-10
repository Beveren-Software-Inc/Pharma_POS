# Copyright (c) 2025, KLiK POS and contributors
# For license information, please see license.txt

import frappe


def execute():
	"""Add custom_allow_additional_amounts to POS Profile."""
	if frappe.db.exists("Custom Field", "POS Profile-custom_allow_additional_amounts"):
		return

	frappe.get_doc({
		"doctype": "Custom Field",
		"dt": "POS Profile",
		"fieldname": "custom_allow_additional_amounts",
		"fieldtype": "Check",
		"label": "Allow Additional Amounts",
		"insert_after": "custom_delivery_required",
		"description": "Show item-level and general additional amount fields (e.g. syringe, misc charges)",
	}).insert(ignore_permissions=True)
