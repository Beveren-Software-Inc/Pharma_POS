# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import strip_html
from klik_pos.util.api_utility import get_next_transaction_number


def _strip_html_text(value):
	if not value:
		return ""
	return strip_html(str(value)).strip()


def _field_text(value):
	if value is None:
		return ""
	if isinstance(value, str) and "<" in value:
		return _strip_html_text(value)
	return str(value).strip()


def _first_non_empty(*values):
	for value in values:
		text = _field_text(value)
		if text:
			return text
	return ""


def _medication_order_entry_to_dict(item):
	"""Map a Patient Medication Order child row to the POS API payload."""
	item_dict = {}

	if hasattr(item, "name") and item.name:
		item_dict["medication_order_entry"] = item.name

	alternative_medicine = _field_text(getattr(item, "alternative_medicine", None))
	alternative_medicine_name = _field_text(getattr(item, "alternative_medicine_name", None))
	old_medicine_code = _field_text(getattr(item, "old_medicine_code", None))
	old_medicine_name = _field_text(getattr(item, "old_medicine_name", None))
	medication = _field_text(getattr(item, "medication", None))

	resolved_drug = _first_non_empty(
		getattr(item, "drug", None),
		getattr(item, "item_code", None),
		getattr(item, "drug_code", None),
		alternative_medicine,
		old_medicine_code,
	)
	resolved_drug_name = _first_non_empty(
		getattr(item, "drug_name", None),
		getattr(item, "item_name", None),
		alternative_medicine_name,
		old_medicine_name,
		medication,
	)

	if resolved_drug:
		item_dict["drug"] = resolved_drug
	if resolved_drug_name:
		item_dict["drug_name"] = resolved_drug_name

	if hasattr(item, "dosage"):
		item_dict["dosage"] = item.dosage

	if hasattr(item, "patient_frequency") and item.patient_frequency:
		item_dict["patient_frequency"] = item.patient_frequency
	elif hasattr(item, "frequency") and item.frequency:
		item_dict["patient_frequency"] = item.frequency
	else:
		item_dict["patient_frequency"] = None

	item_dict["dosage_form"] = getattr(item, "dosage_form", None)
	item_dict["period"] = getattr(item, "period", None)
	item_dict["is_prn"] = getattr(item, "is_prn", 0)
	item_dict["medication_type"] = getattr(item, "medication_type", None)
	item_dict["quantity"] = getattr(item, "quantity", 1) or 1
	item_dict["uom"] = getattr(item, "uom", None)
	item_dict["is_pink"] = int(getattr(item, "is_pink", 0) or 0)
	item_dict["reference_no"] = getattr(item, "reference_no", None) or ""
	item_dict["instructions"] = _strip_html_text(getattr(item, "instructions", None))
	item_dict["no_of_days"] = getattr(item, "no_of_days", None)
	item_dict["route_of_administration"] = getattr(item, "route_of_administration", None)
	item_dict["date"] = getattr(item, "date", None)
	item_dict["time"] = getattr(item, "time", None)
	item_dict["end_date"] = getattr(item, "end_date", None)
	if alternative_medicine:
		item_dict["alternative_medicine"] = alternative_medicine
	if alternative_medicine_name:
		item_dict["alternative_medicine_name"] = alternative_medicine_name
	if old_medicine_code:
		item_dict["old_medicine_code"] = old_medicine_code
	if old_medicine_name:
		item_dict["old_medicine_name"] = old_medicine_name
	if medication:
		item_dict["medication"] = medication

	return item_dict


def _medication_order_entry_has_content(item_dict):
	"""True when a child row has enough data to display (incl. migrated legacy fields)."""
	return bool(
		item_dict.get("drug")
		or item_dict.get("drug_name")
		or item_dict.get("medication")
		or item_dict.get("old_medicine_code")
		or item_dict.get("old_medicine_name")
	)


def _resolve_pharmacy_visit_type():
	"""Use Pharmacy visit type for POS pharmacy encounters (non-charging)."""
	for candidate in ("Pharmacy", "Pharmacy Visit"):
		if frappe.db.exists("DocType", "Visit Type"):
			if frappe.db.exists("Visit Type", candidate):
				return candidate
		return candidate
	return "Pharmacy"


def _extract_medication_order_items(order_doc):
	"""Read child-table medication lines from a Patient Medication Order document."""
	order_meta = frappe.get_meta("Patient Medication Order")
	child_table_fields = [f.fieldname for f in order_meta.fields if f.fieldtype == "Table"]
	if not child_table_fields:
		child_table_fields = [
			"drug_prescription",
			"medication_orders",
			"items",
			"drugs",
			"drug_prescription_detail",
		]

	items = []
	for fieldname in child_table_fields:
		if not hasattr(order_doc, fieldname):
			continue
		child_table = getattr(order_doc, fieldname)
		if not child_table:
			continue
		for row in child_table:
			item_dict = _medication_order_entry_to_dict(row)
			if _medication_order_entry_has_content(item_dict):
				items.append(item_dict)
		if items:
			break

	return items


def resolve_customer_from_patient(patient):
	"""Map a Healthcare Patient to the linked ERPNext Customer record."""
	if not patient or not frappe.db.exists("DocType", "Patient"):
		return None

	patient = (patient or "").strip()
	if not patient or not frappe.db.exists("Patient", patient):
		return None

	linked = frappe.db.get_value("Patient", patient, "customer")
	if linked and frappe.db.exists("Customer", linked):
		return linked

	patient_name = frappe.db.get_value("Patient", patient, "patient_name")
	if patient_name:
		linked = frappe.db.get_value("Customer", {"customer_name": patient_name}, "name")
		if linked and frappe.db.exists("Customer", linked):
			return linked

	return None


def resolve_patient_from_customer(customer):
	"""Map a POS Customer to the linked Healthcare Patient record."""
	if not customer or not frappe.db.exists("DocType", "Patient"):
		return None

	customer = (customer or "").strip()
	if not customer:
		return None

	# Argument may be customer display name rather than Customer.name (ID)
	if not frappe.db.exists("Customer", customer):
		customer_id = frappe.db.get_value("Customer", {"customer_name": customer}, "name")
		if customer_id:
			customer = customer_id

	linked = frappe.db.get_value("Patient", {"customer": customer}, "name")
	if linked and frappe.db.exists("Patient", linked):
		return linked

	if frappe.db.exists("Patient", customer):
		return customer

	customer_name = frappe.db.get_value("Customer", customer, "customer_name")
	if customer_name:
		for filters in ({"patient_name": customer_name}, {"name": customer_name}):
			linked = frappe.db.get_value("Patient", filters, "name")
			if linked and frappe.db.exists("Patient", linked):
				return linked

	return None


@frappe.whitelist()
def resolve_patient_for_customer(customer: str):
	"""Return Patient summary for a selected POS customer (hospital pharmacy)."""
	patient_name = resolve_patient_from_customer(customer)
	if not patient_name:
		return None

	fields = ["name", "patient_name", "patient_id", "file_no"]
	if frappe.db.has_column("Patient", "id_number"):
		fields.append("id_number")

	row = frappe.db.get_value(
		"Patient",
		patient_name,
		fields,
		as_dict=True,
	)
	return row


@frappe.whitelist()
def resolve_customer_for_patient(patient: str):
	"""Return Customer summary for a selected Healthcare Patient (hospital pharmacy)."""
	customer_name = resolve_customer_from_patient(patient)
	if not customer_name:
		return None

	row = frappe.db.get_value(
		"Customer",
		customer_name,
		["name", "customer_name", "customer_type", "default_currency"],
		as_dict=True,
	)
	return row


@frappe.whitelist()
def get_print_formats_for_doctype(doctype: str):
	"""Return available print formats for a DocType (for POS print menus)."""
	doctype = (doctype or "").strip()
	if not doctype:
		frappe.throw("DocType is required")

	default_format = "Standard"
	if frappe.db.exists("DocType", doctype):
		default_format = frappe.get_meta(doctype).default_print_format or "Standard"

	property_default = frappe.db.get_value(
		"Property Setter",
		{
			"doc_type": doctype,
			"property": "default_print_format",
			"doctype_or_field": "DocType",
		},
		"value",
	)
	if property_default:
		default_format = property_default

	filters = {"doc_type": doctype}
	if frappe.db.has_column("Print Format", "disabled"):
		filters["disabled"] = 0

	rows = frappe.get_all(
		"Print Format",
		filters=filters,
		fields=["name", "print_format_type", "raw_printing"],
		order_by="name asc",
	)

	enable_raw_printing = frappe.db.get_single_value("Print Settings", "enable_raw_printing")

	formats = ["Standard"]
	for row in rows:
		name = row.name
		if name in formats:
			continue
		if row.get("print_format_type") == "JS":
			continue
		if row.get("raw_printing") and not enable_raw_printing:
			continue
		formats.append(name)

	if default_format and default_format in formats:
		formats.remove(default_format)
		formats.insert(0, default_format)
	elif default_format and default_format not in formats and default_format != "Standard":
		formats.insert(0, default_format)

	return {"formats": formats, "default": default_format or "Standard"}


@frappe.whitelist()
def search_patients(search_query: str):
	"""
	Search for Patients by name, file no (KLiK patient id), id number, or document name.
	Returns a list of matching patients.
	"""
	try:
		if not frappe.db.exists("DocType", "Patient"):
			frappe.throw("Patient doctype not found. Please ensure the healthcare app is installed.")

		search_query = (search_query or "").strip()
		if not search_query:
			return []

		search_term = f"%{search_query}%"
		patient_meta = frappe.get_meta("Patient")
		available_fields = {f.fieldname for f in patient_meta.fields}

		fields = ["name", "patient_name"]
		if "file_no" in available_fields:
			fields.append("file_no")
		if "patient_id" in available_fields:
			fields.append("patient_id")
		if "id_number" in available_fields:
			fields.append("id_number")

		or_filters = [
			["patient_name", "like", search_term],
			["name", "like", search_term],
		]
		if "file_no" in available_fields:
			or_filters.append(["file_no", "like", search_term])
		if "patient_id" in available_fields:
			or_filters.append(["patient_id", "like", search_term])
		if "id_number" in available_fields:
			or_filters.append(["id_number", "like", search_term])

		patients = frappe.get_all(
			"Patient",
			fields=fields,
			or_filters=or_filters,
			order_by="patient_name asc",
			limit=50,
		)

		for patient in patients:
			file_no = (patient.get("file_no") or patient.get("name") or "").strip()
			if file_no:
				patient["file_no"] = file_no
			if not patient.get("patient_id") and file_no:
				patient["patient_id"] = file_no

		return patients
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error searching Patients")
		frappe.throw(f"Failed to search Patients: {str(e)}")


@frappe.whitelist()
def get_pending_inpatient_medication_orders(patient: str):
	"""
	Get Inpatient Medication Orders for dispensing.
	Excludes Completed, Draft, and Unsigned prescriptions from the pending tab.
	"""
	try:
		# Check if Patient Medication Order doctype exists
		if not frappe.db.exists("DocType", "Patient Medication Order"):
			frappe.throw("Patient Medication Order doctype not found. Please ensure the healthcare app is installed.")
		
		# Get the doctype meta to check which fields exist
		order_meta = frappe.get_meta("Patient Medication Order")
		available_fields = [f.fieldname for f in order_meta.fields]
		
		# Build fields list based on what's available
		fields_to_fetch = ["name", "patient", "patient_name", "status"]
		order_by_field = None
		
		# Check if posting_date exists
		if "posting_date" in available_fields:
			fields_to_fetch.append("posting_date")
			order_by_field = "posting_date desc"
		elif "creation" in available_fields:
			# Fallback to creation date if posting_date doesn't exist
			fields_to_fetch.append("creation")
			order_by_field = "creation desc"
		
		# Pending tab: active orders only (exclude completed, draft, unsigned)
		orders = frappe.get_all(
			"Patient Medication Order",
			fields=fields_to_fetch,
			filters={
				"patient": patient,
				"status": ["not in", ["Completed", "Draft", "Unsigned"]],
			},
			order_by=order_by_field if order_by_field else "name desc"
		)
		
		# For each order, get the child table items
		for order in orders:
			order_doc = frappe.get_doc("Patient Medication Order", order.name)
			order["healthcare_practitioner"] = (
				getattr(order_doc, "healthcare_practitioner", None)
				or getattr(order_doc, "practitioner", None)
				or getattr(order_doc, "prescribing_practitioner", None)
			)
			order["healthcare_practitioner_name"] = (
				getattr(order_doc, "healthcare_practitioner_name", None)
				or getattr(order_doc, "practitioner_name", None)
			)
			order["custom_reference_type"] = getattr(order_doc, "custom_reference_type", None)
			order["custom_reference_name"] = getattr(order_doc, "custom_reference_name", None)
			if not order["custom_reference_type"] or not order["custom_reference_name"]:
				if getattr(order_doc, "patient_encounter", None):
					order["custom_reference_type"] = "Patient Visit"
					order["custom_reference_name"] = order_doc.patient_encounter
				elif getattr(order_doc, "inpatient_record", None):
					order["custom_reference_type"] = "Inpatient Admission"
					order["custom_reference_name"] = order_doc.inpatient_record
			order["items"] = _extract_medication_order_items(order_doc)
		return orders
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching Patient Medication Orders")
		frappe.throw(f"Failed to fetch Patient Medication Orders: {str(e)}")


@frappe.whitelist()
def get_patient_medication_order_history(patient: str, limit: int = 50):
	"""
	Get completed/non-pending medication orders for a patient.
	Used by hospital pharmacy history tab.
	"""
	try:
		if not frappe.db.exists("DocType", "Patient Medication Order"):
			frappe.throw("Patient Medication Order doctype not found. Please ensure the healthcare app is installed.")

		try:
			limit = max(1, min(int(limit), 50))
		except Exception:
			limit = 50

		order_meta = frappe.get_meta("Patient Medication Order")
		available_fields = [f.fieldname for f in order_meta.fields]
		fields_to_fetch = ["name", "patient", "patient_name", "status"]
		order_by_field = "modified desc"

		if "posting_date" in available_fields:
			fields_to_fetch.append("posting_date")
			order_by_field = "posting_date desc"
		elif "creation" in available_fields:
			fields_to_fetch.append("creation")
			order_by_field = "creation desc"

		# History tab: completed orders only (pending tab shows all other statuses).
		orders = frappe.get_all(
			"Patient Medication Order",
			fields=fields_to_fetch,
			filters={
				"patient": patient,
				"status": "Completed",
			},
			order_by=order_by_field,
			limit=limit,
		)

		# Reuse existing item extraction for consistency.
		for order in orders:
			order_doc = frappe.get_doc("Patient Medication Order", order.name)
			order["healthcare_practitioner"] = (
				getattr(order_doc, "healthcare_practitioner", None)
				or getattr(order_doc, "practitioner", None)
				or getattr(order_doc, "prescribing_practitioner", None)
			)
			order["healthcare_practitioner_name"] = (
				getattr(order_doc, "healthcare_practitioner_name", None)
				or getattr(order_doc, "practitioner_name", None)
			)
			order["custom_reference_type"] = getattr(order_doc, "custom_reference_type", None)
			order["custom_reference_name"] = getattr(order_doc, "custom_reference_name", None)
			if not order["custom_reference_type"] or not order["custom_reference_name"]:
				if getattr(order_doc, "patient_encounter", None):
					order["custom_reference_type"] = "Patient Visit"
					order["custom_reference_name"] = order_doc.patient_encounter
				elif getattr(order_doc, "inpatient_record", None):
					order["custom_reference_type"] = "Inpatient Admission"
					order["custom_reference_name"] = order_doc.inpatient_record
			order["items"] = _extract_medication_order_items(order_doc)

		return orders
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching Medication Order history")
		frappe.throw(f"Failed to fetch Medication Order history: {str(e)}")


def _get_patient_diagnosis_entries(patient: str, limit: int = 25):
	if not frappe.db.exists("DocType", "Medical Diagnosis Entry"):
		return []

	meta = frappe.get_meta("Medical Diagnosis Entry")
	available = {f.fieldname for f in meta.fields}
	fields = [
		f
		for f in (
			"name",
			"diagnosis",
			"diagnosis_name",
			"details",
			"posting_date",
			"practitioner_name",
			"visit_num",
			"inpatient_admission",
		)
		if f in available
	]
	if not fields:
		return []

	filters = {"patient": patient}
	if "docstatus" in available:
		filters["docstatus"] = ["<", 2]

	order_by = "posting_date desc" if "posting_date" in available else "modified desc"
	rows = frappe.get_all(
		"Medical Diagnosis Entry",
		filters=filters,
		fields=fields,
		order_by=order_by,
		limit=limit,
	)
	for row in rows:
		if row.get("details"):
			row["details"] = _strip_html_text(row["details"])
	return rows


def _get_patient_warning_messages(patient: str, limit: int = 25):
	if not frappe.db.exists("DocType", "Warning Message"):
		return []

	meta = frappe.get_meta("Warning Message")
	available = {f.fieldname for f in meta.fields}
	fields = [
		f
		for f in (
			"name",
			"trans_id",
			"type_of_warning",
			"warning",
			"high_risk_text",
			"posting_date",
			"practitioner_name",
			"warning_message_type",
		)
		if f in available
	]
	if not fields:
		return []

	filters = {"patient": patient}
	if "docstatus" in available:
		filters["docstatus"] = ["<", 2]

	order_by = "posting_date desc" if "posting_date" in available else "modified desc"
	rows = frappe.get_all(
		"Warning Message",
		filters=filters,
		fields=fields,
		order_by=order_by,
		limit=limit,
	)
	for row in rows:
		for key in ("warning", "high_risk_text"):
			if row.get(key):
				row[key] = _strip_html_text(row[key])
	return rows


def _serialize_patient_upload_row(row):
	"""Normalize a Patient Upload Document child row for POS."""
	if isinstance(row, dict):
		get = row.get
	else:
		get = lambda key, default=None: getattr(row, key, default)

	file_url = get("document")
	return {
		"name": get("name"),
		"file_name": get("file_name") or get("document_name"),
		"document_name": get("document_name"),
		"document_type": get("document_type"),
		"transaction_no": get("transaction_no"),
		"upload_remarks": get("upload_remarks"),
		"document": file_url,
	}


def _get_patient_upload_documents(patient: str):
	"""Return Patient Upload Document rows from Healthcare Patient record."""
	if not patient:
		return []

	patient = (patient or "").strip()
	if not patient:
		return []

	if not frappe.db.exists("Patient", patient):
		resolved = resolve_patient_from_customer(patient)
		if not resolved or not frappe.db.exists("Patient", resolved):
			return []
		patient = resolved

	documents = []
	seen_urls = set()

	# Primary: query child table directly (Patient > patient_document > Patient Upload Document)
	if frappe.db.exists("DocType", "Patient Upload Document"):
		rows = frappe.get_all(
			"Patient Upload Document",
			filters={"parent": patient, "parenttype": "Patient"},
			fields=[
				"name",
				"document_name",
				"file_name",
				"document_type",
				"transaction_no",
				"upload_remarks",
				"document",
			],
			order_by="idx asc",
		)
		for row in rows:
			serialized = _serialize_patient_upload_row(row)
			file_url = serialized.get("document")
			if file_url and file_url in seen_urls:
				continue
			if file_url:
				seen_urls.add(file_url)
			if (
				serialized.get("document")
				or serialized.get("file_name")
				or serialized.get("document_name")
				or serialized.get("document_type")
			):
				documents.append(serialized)

	# Fallback: load via parent document
	if not documents:
		patient_doc = frappe.get_doc("Patient", patient)
		for row in patient_doc.get("patient_document") or []:
			serialized = _serialize_patient_upload_row(row)
			file_url = serialized.get("document")
			if file_url and file_url in seen_urls:
				continue
			if file_url:
				seen_urls.add(file_url)
			documents.append(serialized)

	# Include CPR / National ID attach fields from Patient when present
	patient_meta = frappe.get_meta("Patient")
	attach_fields = [
		("cprigama_front_photo", "CPR/Igama Front Photo"),
		("cprigama_back_photo", "CPR/Igama Back Photo"),
	]
	for fieldname, label in attach_fields:
		if not patient_meta.has_field(fieldname):
			continue
		file_url = frappe.db.get_value("Patient", patient, fieldname)
		if file_url and file_url not in seen_urls:
			seen_urls.add(file_url)
			documents.append(
				{
					"name": f"{patient}-{fieldname}",
					"file_name": label,
					"document_name": label,
					"document_type": "National ID",
					"transaction_no": None,
					"upload_remarks": None,
					"document": file_url,
				}
			)

	return documents


@frappe.whitelist()
def get_patient_documents(patient: str = None, customer: str = None):
	"""Return Healthcare patient upload documents for POS (by patient or customer)."""
	try:
		patient_key = (patient or "").strip()
		customer_key = (customer or "").strip()

		if not patient_key and customer_key:
			patient_key = resolve_patient_from_customer(customer_key) or ""

		if not patient_key:
			frappe.throw("Patient or customer is required")

		documents = _get_patient_upload_documents(patient_key)
		return {
			"success": True,
			"patient": patient_key,
			"patient_documents": documents,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Get patient documents error")
		return {"success": False, "message": str(e), "patient_documents": []}


@frappe.whitelist()
def get_patient_history_summary(patient: str, limit: int = 10):
	"""
	Patient details plus recent visits and medication orders for POS history tab.
	"""
	try:
		if not patient:
			frappe.throw("Patient is required")

		try:
			limit = max(1, min(int(limit), 25))
		except Exception:
			limit = 10

		patient_details = {}
		if frappe.db.exists("DocType", "Patient"):
			patient_fields = ["name", "patient_name", "sex", "dob", "blood_group", "mobile", "email"]
			patient_meta = frappe.get_meta("Patient")
			available = {f.fieldname for f in patient_meta.fields}
			fields = [f for f in patient_fields if f in available]
			if "file_no" in available:
				fields.append("file_no")
			if "allergies" in available:
				fields.append("allergies")
			if "medication" in available:
				fields.append("medication")
			if "id_number" in available:
				fields.append("id_number")
			if fields:
				patient_details = frappe.db.get_value("Patient", patient, fields, as_dict=True) or {}

		visits = []
		for doctype in ("Patient Visit", "Patient Encounter"):
			if not frappe.db.exists("DocType", doctype):
				continue
			meta = frappe.get_meta(doctype)
			fields = {f.fieldname for f in meta.fields}
			fetch = ["name", "patient", "patient_name"]
			date_field = None
			for candidate in ("visit_date", "encounter_date", "posting_date", "creation"):
				if candidate in fields:
					date_field = candidate
					fetch.append(candidate)
					break
			if "visit_type" in fields:
				fetch.append("visit_type")
			if "status" in fields:
				fetch.append("status")
			order_by = f"{date_field} desc" if date_field else "modified desc"
			rows = frappe.get_all(
				doctype,
				fields=fetch,
				filters={"patient": patient},
				order_by=order_by,
				limit=limit,
			)
			for row in rows:
				row["doctype"] = doctype
			visits.extend(rows)
			break

		medication_history = get_patient_medication_order_history(patient, limit=limit)
		diagnosis_entries = _get_patient_diagnosis_entries(patient, limit=limit)
		warning_messages = _get_patient_warning_messages(patient, limit=limit)
		patient_documents = _get_patient_upload_documents(patient)
		return {
			"patient": patient_details or {"name": patient},
			"visits": visits,
			"medication_orders": medication_history,
			"diagnosis_entries": diagnosis_entries,
			"warning_messages": warning_messages,
			"patient_documents": patient_documents,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching patient history summary")
		frappe.throw(f"Failed to fetch patient history: {str(e)}")


@frappe.whitelist()
def create_patient_visit(patient: str):
	"""
	Create a non-charging pharmacy patient visit from POS.

	Only inserts a Patient Visit / Patient Encounter (draft). Does not create
	Sales Order or invoice — dispensing stock is handled separately on Dispense.
	"""
	case_no = get_next_transaction_number('Patient Visit', fieldname='case_no')
	try:
		if not patient:
			frappe.throw("Patient is required")

		visit_doctype = None
		if frappe.db.exists("DocType", "Patient Visit"):
			visit_doctype = "Patient Visit"
		elif frappe.db.exists("DocType", "Patient Encounter"):
			visit_doctype = "Patient Encounter"
		else:
			frappe.throw("Neither Patient Visit nor Patient Encounter doctype is available.")

		doc = frappe.new_doc(visit_doctype)
		meta = frappe.get_meta(visit_doctype)
		fields = {f.fieldname for f in meta.fields}

		if "patient" in fields:
			doc.patient = patient

		patient_name = frappe.db.get_value("Patient", patient, "patient_name") or patient
		if "patient_name" in fields:
			doc.patient_name = patient_name

		doc.case_no = case_no
		today = frappe.utils.nowdate()
		for date_field in ("encounter_date", "visit_date", "posting_date"):
			if date_field in fields and not getattr(doc, date_field, None):
				setattr(doc, date_field, today)

		if "company" in fields:
			default_company = frappe.defaults.get_defaults().get("company")
			if default_company:
				doc.company = default_company
		if "visit_type" in fields:
			doc.visit_type = _resolve_pharmacy_visit_type()

		if "submit_orders_on_save" in fields:
			doc.submit_orders_on_save = 0

		doc.insert(ignore_permissions=True)

		return {
			"doctype": visit_doctype,
			"name": doc.name,
			"patient": patient,
			"patient_name": patient_name,
			"visit_type": getattr(doc, "visit_type", None),
			"docstatus": doc.docstatus,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error creating Patient Visit")
		frappe.throw(f"Failed to create patient visit: {str(e)}")
