import sys
from unittest.mock import MagicMock, patch

from frappe.tests.utils import FrappeTestCase

from klik_pos.api.employee_billing import (
	_get_or_create_employee_customer,
	_link_employee_to_customer,
)


class TestEmployeeCustomerLink(FrappeTestCase):
	"""The Customer that represents an employee must always carry the Employee link."""

	@patch("klik_pos.api.employee_billing.frappe")
	def test_backfills_link_on_customer_created_before_fields_existed(self, mock_frappe):
		"""Existing customer with NULL link fields (old transactions) gets linked."""
		mock_frappe.db.has_column.return_value = True
		mock_frappe.db.exists.return_value = True
		mock_frappe.db.get_value.side_effect = ["", None]

		result = _link_employee_to_customer("EMP-001", "EMP-001", "Jane Doe")

		self.assertEqual(result, "EMP-001")
		mock_frappe.db.set_value.assert_called_once_with(
			"Customer",
			"EMP-001",
			{"custom_employee": "EMP-001", "custom_employee_name": "Jane Doe"},
			update_modified=False,
		)

	@patch("klik_pos.api.employee_billing.frappe")
	def test_skips_write_when_customer_already_linked(self, mock_frappe):
		"""Idempotent: dispensing twice does not rewrite the Customer."""
		mock_frappe.db.has_column.return_value = True
		mock_frappe.db.exists.return_value = True
		mock_frappe.db.get_value.side_effect = ["EMP-001", "Jane Doe"]

		result = _link_employee_to_customer("EMP-001", "EMP-001", "Jane Doe")

		self.assertEqual(result, "EMP-001")
		mock_frappe.db.set_value.assert_not_called()

	@patch("klik_pos.api.employee_billing.frappe")
	def test_overwrites_stale_link_values(self, mock_frappe):
		"""A stale link/name is re-synced with the employee being dispensed to."""
		mock_frappe.db.has_column.return_value = True
		mock_frappe.db.exists.return_value = True
		mock_frappe.db.get_value.side_effect = ["EMP-999", "Old Name"]

		_link_employee_to_customer("EMP-001", "EMP-001", "Jane Doe")

		mock_frappe.db.set_value.assert_called_once_with(
			"Customer",
			"EMP-001",
			{"custom_employee": "EMP-001", "custom_employee_name": "Jane Doe"},
			update_modified=False,
		)

	@patch("klik_pos.api.employee_billing.frappe")
	def test_looks_up_employee_name_when_not_provided(self, mock_frappe):
		mock_frappe.db.has_column.return_value = True
		mock_frappe.db.exists.return_value = True
		mock_frappe.db.get_value.side_effect = ["Jane Doe", "", None]

		_link_employee_to_customer("EMP-001", "EMP-001")

		mock_frappe.db.get_value.assert_any_call("Employee", "EMP-001", "employee_name")
		self.assertEqual(
			mock_frappe.db.set_value.call_args[0][2]["custom_employee_name"], "Jane Doe"
		)

	@patch("klik_pos.api.employee_billing.frappe")
	def test_noop_when_customer_fields_not_installed(self, mock_frappe):
		"""Sites without the custom fields keep working (no-op)."""
		mock_frappe.db.has_column.return_value = False

		result = _link_employee_to_customer("EMP-001", "EMP-001", "Jane Doe")

		self.assertEqual(result, "EMP-001")
		mock_frappe.db.set_value.assert_not_called()
		mock_frappe.db.get_value.assert_not_called()

	@patch("klik_pos.api.employee_billing.frappe")
	def test_noop_when_customer_does_not_exist(self, mock_frappe):
		mock_frappe.db.has_column.return_value = True
		mock_frappe.db.exists.return_value = False

		result = _link_employee_to_customer("EMP-001", "EMP-001", "Jane Doe")

		self.assertEqual(result, "EMP-001")
		mock_frappe.db.set_value.assert_not_called()

	@patch("klik_pos.api.employee_billing._link_employee_to_customer")
	@patch("klik_pos.api.employee_billing.frappe")
	def test_resolver_links_employee_after_healthcare_creates_customer(
		self, mock_frappe, mock_link
	):
		"""First-time dispense: created customer is linked before being returned."""
		employee = MagicMock()
		employee.employee_name = "Jane Doe"
		mock_frappe.db.exists.return_value = True
		mock_frappe.get_cached_doc.return_value = employee
		mock_link.return_value = "EMP-001"

		fake_billing = MagicMock()
		fake_billing._get_or_create_employee_customer.return_value = "EMP-001"
		with patch.dict(sys.modules, {"healthcare.api.billing": fake_billing}):
			result = _get_or_create_employee_customer("EMP-001")

		self.assertEqual(result, "EMP-001")
		mock_link.assert_called_once_with("EMP-001", "EMP-001", "Jane Doe")

	@patch("klik_pos.api.employee_billing._create_or_get_employee_customer")
	@patch("klik_pos.api.employee_billing._link_employee_to_customer")
	@patch("klik_pos.api.employee_billing.frappe")
	def test_resolver_links_employee_without_healthcare_installed(
		self, mock_frappe, mock_link, mock_local_create
	):
		"""Without healthcare the local creator runs, then linking still happens."""
		employee = MagicMock()
		employee.employee_name = "Jane Doe"
		mock_frappe.db.exists.return_value = True
		mock_frappe.get_cached_doc.return_value = employee
		mock_local_create.return_value = "EMP-001"
		mock_link.return_value = "EMP-001"

		with patch.dict(sys.modules, {"healthcare.api.billing": None}):
			result = _get_or_create_employee_customer("EMP-001")

		self.assertEqual(result, "EMP-001")
		mock_local_create.assert_called_once_with("EMP-001", "Jane Doe")
		mock_link.assert_called_once_with("EMP-001", "EMP-001", "Jane Doe")

	@patch("klik_pos.api.employee_billing._link_employee_to_customer")
	@patch("klik_pos.api.employee_billing.frappe")
	def test_resolver_rejects_unknown_employee(self, mock_frappe, mock_link):
		mock_frappe.db.exists.return_value = False
		mock_frappe.throw.side_effect = ValueError("Employee EMP-404 not found")

		with self.assertRaises(ValueError):
			_get_or_create_employee_customer("EMP-404")

		mock_link.assert_not_called()
