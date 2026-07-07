import frappe
from frappe.utils import cint


def _prescription_frequency_has_active_field():
	return frappe.db.has_column("Prescription Frequency", "active")


def _prescription_frequency_select_fields():
	meta = frappe.get_meta("Prescription Frequency")
	available_fields = {f.fieldname for f in meta.fields}

	fields = ["name"]
	if "dosage" in available_fields:
		fields.append("dosage")
	if "frequency" in available_fields:
		fields.append("frequency")
	elif "prescription_frequency" in available_fields:
		fields.append("prescription_frequency")
	if _prescription_frequency_has_active_field():
		fields.append("active")

	return fields


def _prescription_frequency_order_by(fields):
	if "dosage" in fields:
		return "dosage asc"
	if "frequency" in fields:
		return "frequency asc"
	if "prescription_frequency" in fields:
		return "prescription_frequency asc"
	return "name asc"


def _fetch_active_prescription_frequencies(fields, order_by):
	"""Only rows with active checkbox ticked (1). NULL/0 are excluded."""
	select_fields = ", ".join(f"`{field}`" for field in fields)
	return frappe.db.sql(
		f"""
		SELECT {select_fields}
		FROM `tabPrescription Frequency`
		WHERE IFNULL(`active`, 0) = 1
		ORDER BY {order_by}
		""",
		as_dict=True,
	)


@frappe.whitelist()
def get_prescription_frequencies():
	"""
	Fetch active Prescription Frequency records from the healthcare app.
	Only returns rows where the Active checkbox is ticked.
	"""
	try:
		if not frappe.db.exists("DocType", "Prescription Frequency"):
			frappe.throw(
				"Prescription Frequency doctype not found. Please ensure the healthcare app is installed."
			)

		fields = _prescription_frequency_select_fields()
		order_by = _prescription_frequency_order_by(fields)

		if _prescription_frequency_has_active_field():
			rows = _fetch_active_prescription_frequencies(fields, order_by)
			return [row for row in rows if cint(row.get("active")) == 1]

		prescription = frappe.get_all(
			"Prescription Frequency",
			fields=fields,
			filters={},
			order_by=order_by,
		)
		print(f"Fetched {len(prescription)} Prescription Frequencies (Active field not present).")
		return prescription


	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching Prescription Frequencies")
		frappe.throw(f"Failed to fetch Prescription Frequencies: {str(e)}")
