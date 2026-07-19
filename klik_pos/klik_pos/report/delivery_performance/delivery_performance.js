// Copyright (c) 2026, Beveren Sooftware Inc and contributors
// For license information, please see license.txt

frappe.query_reports["Delivery Performance"] = {
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "delivery_personnel",
			label: __("Delivery Personnel"),
			fieldtype: "Link",
			options: "Delivery Personnel",
		},
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "group_by",
			label: __("Group By"),
			fieldtype: "Select",
			options: "Delivery Personnel\nInvoice",
			default: "Delivery Personnel",
		},
	],
};
