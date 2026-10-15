# Copyright (c) 2026, KLiK PoS and contributors
# For license information, please see license.txt

"""
Custom fields that link to DocTypes shipped by the optional Healthcare app.

They are created from code instead of coming from ``fixtures/custom_field.json``
on purpose. Frappe requires the ``options`` of every Link field to be an existing
DocType (``frappe.core.doctype.doctype.doctype.check_link_table_options``).
Fixture import skips that check (``frappe.flags.in_fixtures``), so a fixture may
reference a DocType that is not installed - but Frappe re-validates *every* field
of a DocType whenever a single Custom Field is inserted on it. That is how this
bites: installing KLiK PoS on a site without Healthcare left
``Sales Invoice.custom_health_insurance`` pointing at the missing
``Health Insurance`` DocType, and the next Custom Field created for Sales Invoice
- ERPNext's own regional setup while it creates a Company, or the ERPNext
bootstrap ``bench run-tests`` performs - aborted with::

	WrongOptionsDoctypeLinkError: Sales Invoice: Options must be a valid DocType
	for field Health Insurance in row 254

which took the rest of the site setup, and the test run with it, down.

Creating the fields from code, keyed on the presence of the DocType they link to,
gives a site with Healthcare exactly the fields it had before, while a site
without it installs, migrates and runs tests cleanly.

Wired up as ``after_install`` and ``after_migrate`` in ``hooks.py``. Both run
after fixtures are synced, and the function is idempotent, so it is also the
repair path for sites that already carry a dangling field.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

#: Custom Fields whose ``options`` point at a DocType owned by the Healthcare
#: app, grouped by the DocType they extend.
#:
#: ``fieldname`` must not change: it names a column that may already exist, so a
#: site that has the field keeps both its data and its place in the form.
HEALTHCARE_LINK_FIELDS = {
	"Sales Invoice": [
		{
			"fieldname": "custom_health_insurance",
			"label": "Health Insurance",
			"fieldtype": "Link",
			"options": "Health Insurance",
			"insert_after": "custom_insurance",
			# the value these fields carried while they were fixtures, so they stay
			# editable and removable in Customize Form like the app's other fields
			"is_system_generated": 0,
		},
	],
	"Sales Order Item": [
		{
			"fieldname": "custom_prescription_frequency",
			"label": "Prescription Frequency",
			"fieldtype": "Link",
			"options": "Prescription Frequency",
			"insert_after": "custom_column_break_3vdka",
			"is_system_generated": 0,
		},
	],
}


def ensure_healthcare_link_fields():
	"""Create or drop the custom fields that link to Healthcare DocTypes.

	Runs on install and on every migrate (see ``hooks.py``):

	* target DocType present (Healthcare installed): add the field when it is
	  missing. A field that already exists is left untouched, so an upgrade never
	  rewrites its definition or its data.
	* target DocType absent: delete the field, because a Link to a DocType that
	  does not exist makes Frappe refuse every later Custom Field creation on that
	  DocType (see the module docstring). The target the field actually carries is
	  judged, so a field an administrator has re-pointed at an existing DocType is
	  kept.
	"""
	to_create = {}
	to_remove = []

	for doctype, definitions in HEALTHCARE_LINK_FIELDS.items():
		if not frappe.db.exists("DocType", doctype):
			# the app that owns the extended DocType is not installed yet; the
			# next migrate picks this up
			continue

		for definition in definitions:
			existing = frappe.db.get_value(
				"Custom Field",
				{"dt": doctype, "fieldname": definition["fieldname"]},
				["name", "options"],
				as_dict=True,
			)

			if existing:
				target = existing.options or definition["options"]
				if not frappe.db.exists("DocType", target):
					to_remove.append(existing.name)
			elif frappe.db.exists("DocType", definition["options"]):
				to_create.setdefault(doctype, []).append(definition)

	if to_remove:
		remove_dangling_custom_fields(to_remove)

	if to_create:
		create_custom_fields(to_create)


def remove_dangling_custom_fields(names: list):
	"""Delete Custom Fields that link to a DocType that is not installed.

	``Custom Field.on_trash`` clears the meta cache, drops the field's Property
	Setters and takes it out of any DocType Layout. The table column is left in
	place, exactly as Frappe does for any other deleted Custom Field, so nothing
	is lost if the app owning the target DocType is installed again.
	"""
	for name in names:
		frappe.delete_doc("Custom Field", name, ignore_permissions=True, force=True, ignore_missing=True)
		print(f"KLiK PoS: removed Custom Field '{name}' - it links to a DocType that is not installed")
