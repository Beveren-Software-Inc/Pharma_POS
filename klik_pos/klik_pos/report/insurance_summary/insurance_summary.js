// Copyright (c) 2026, Beveren Sooftware Inc and contributors
// For license information, please see license.txt

frappe.query_reports["Insurance Summary"] = {
    "filters": [
        {
            "fieldname": "health_insurance",
            "label": "Health Insurance",
            "fieldtype": "Link",
            "options": "Healthcare Insurance Company"
        },
        {
            "fieldname": "company",
            "label": "Company",
            "fieldtype": "Link",
            "options": "Company"
        },
        {
            "fieldname": "start_date",
            "label": "Start Date",
            "fieldtype": "Date"
        },
        {
            "fieldname": "end_date",
            "label": "End Date",
            "fieldtype": "Date"
        }
    ]
};