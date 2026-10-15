"""Custom fields that link to the optional Healthcare app must stay consistent.

`klik_pos.hooks` runs `ensure_healthcare_link_fields` on install and on every
migrate; these tests cover the two branches it has to keep in sync - the fields
being present when Healthcare is installed, and absent when it is not - plus the
invariant a dangling Link breaks: Frappe validates every field of a DocType
whenever a single Custom Field is inserted on it, so a Link to a missing DocType
makes all later custom field creation on that DocType fail.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from klik_pos.setup.healthcare_link_fields import (
	HEALTHCARE_LINK_FIELDS,
	ensure_healthcare_link_fields,
)

HEALTHCARE_DOCTYPES = {
	definition["options"] for fields in HEALTHCARE_LINK_FIELDS.values() for definition in fields
}


def _only_these_doctypes(*doctypes):
	"""`frappe.db.exists("DocType", name)` side effect for the given DocTypes."""
	existing = set(doctypes)

	def exists(*args):
		return args[-1] in existing

	return exists


def _stored_custom_field(*args, **_kwargs):
	"""`frappe.db.get_value` side effect: the field as it is stored on the site."""
	doctype, fieldname = args[1]["dt"], args[1]["fieldname"]
	for definition in HEALTHCARE_LINK_FIELDS.get(doctype, []):
		if definition["fieldname"] == fieldname:
			return frappe._dict(name=f"{doctype}-{fieldname}", options=definition["options"])
	return None


class TestHealthcareLinkFields(FrappeTestCase):
	def test_creates_the_fields_when_healthcare_is_installed(self):
		targets = ("Sales Invoice", "Sales Order Item")
		with (
			patch("klik_pos.setup.healthcare_link_fields.frappe") as mock_frappe,
			patch("klik_pos.setup.healthcare_link_fields.create_custom_fields") as mock_create,
		):
			mock_frappe.db.exists.side_effect = _only_these_doctypes(*targets, *HEALTHCARE_DOCTYPES)
			mock_frappe.db.get_value.return_value = None

			ensure_healthcare_link_fields()

		created = mock_create.call_args.args[0]
		self.assertEqual(sorted(created), sorted(targets))
		self.assertEqual(created["Sales Invoice"][0]["fieldname"], "custom_health_insurance")
		self.assertEqual(created["Sales Order Item"][0]["fieldname"], "custom_prescription_frequency")
		mock_frappe.delete_doc.assert_not_called()

	def test_drops_the_fields_when_healthcare_is_not_installed(self):
		"""This is the shape of the CI bootstrap failure: klik_pos without healthcare."""
		with (
			patch("klik_pos.setup.healthcare_link_fields.frappe") as mock_frappe,
			patch("klik_pos.setup.healthcare_link_fields.create_custom_fields") as mock_create,
		):
			mock_frappe.db.exists.side_effect = _only_these_doctypes("Sales Invoice", "Sales Order Item")
			mock_frappe.db.get_value.side_effect = _stored_custom_field

			ensure_healthcare_link_fields()

		mock_create.assert_not_called()
		removed = [call.args[1] for call in mock_frappe.delete_doc.call_args_list]
		self.assertEqual(
			removed,
			["Sales Invoice-custom_health_insurance", "Sales Order Item-custom_prescription_frequency"],
		)
		# force skips the linked-documents check, ignore_missing keeps it repeatable
		self.assertEqual(
			mock_frappe.delete_doc.call_args.kwargs,
			{"ignore_permissions": True, "force": True, "ignore_missing": True},
		)

	def test_leaves_existing_fields_untouched(self):
		with (
			patch("klik_pos.setup.healthcare_link_fields.frappe") as mock_frappe,
			patch("klik_pos.setup.healthcare_link_fields.create_custom_fields") as mock_create,
		):
			mock_frappe.db.exists.side_effect = _only_these_doctypes(
				"Sales Invoice", "Sales Order Item", *HEALTHCARE_DOCTYPES
			)
			mock_frappe.db.get_value.side_effect = _stored_custom_field

			ensure_healthcare_link_fields()

		mock_create.assert_not_called()
		mock_frappe.delete_doc.assert_not_called()

	def test_judges_the_target_the_field_actually_carries(self):
		"""A re-pointed field is kept only while its own target exists."""
		repointed = {
			"custom_health_insurance": "Some Other Doctype",  # exists, so keep it
			"custom_prescription_frequency": "Missing Doctype",  # gone, so drop it
		}
		with (
			patch("klik_pos.setup.healthcare_link_fields.frappe") as mock_frappe,
			patch("klik_pos.setup.healthcare_link_fields.create_custom_fields") as mock_create,
		):
			mock_frappe.db.exists.side_effect = _only_these_doctypes(
				"Sales Invoice", "Sales Order Item", "Health Insurance", "Some Other Doctype"
			)
			mock_frappe.db.get_value.side_effect = lambda *args, **_kwargs: frappe._dict(
				name=f"{args[1]['dt']}-{args[1]['fieldname']}",
				options=repointed[args[1]["fieldname"]],
			)

			ensure_healthcare_link_fields()

		mock_create.assert_not_called()
		removed = [call.args[1] for call in mock_frappe.delete_doc.call_args_list]
		self.assertEqual(removed, ["Sales Order Item-custom_prescription_frequency"])

	def test_skips_doctypes_that_are_not_installed(self):
		with (
			patch("klik_pos.setup.healthcare_link_fields.frappe") as mock_frappe,
			patch("klik_pos.setup.healthcare_link_fields.create_custom_fields") as mock_create,
		):
			mock_frappe.db.exists.return_value = False

			ensure_healthcare_link_fields()

		mock_frappe.db.get_value.assert_not_called()
		mock_create.assert_not_called()
		mock_frappe.delete_doc.assert_not_called()

	def test_no_field_links_to_a_doctype_that_is_missing_on_this_site(self):
		"""Read-only guard against re-introducing a dangling Link (e.g. via fixtures)."""
		for doctype, definitions in HEALTHCARE_LINK_FIELDS.items():
			for definition in definitions:
				name = frappe.db.get_value(
					"Custom Field",
					{"dt": doctype, "fieldname": definition["fieldname"]},
					"name",
				)
				if not name:
					continue

				self.assertTrue(
					frappe.db.exists("DocType", definition["options"]),
					f"{name} links to {definition['options']}, which is not installed on this site",
				)
