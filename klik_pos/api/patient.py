# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

import frappe
from klik_pos.util.api_utility import get_next_transaction_number

@frappe.whitelist()
def search_patients(search_query: str):
	"""
	Search for Patients by name, patient_id, or file_no.
	Returns a list of matching patients.
	"""
	try:
		# Check if Patient doctype exists (from healthcare app)
		if not frappe.db.exists("DocType", "Patient"):
			frappe.throw("Patient doctype not found. Please ensure the healthcare app is installed.")
		
		search_term = f"%{search_query}%"
		
		# Use frappe.get_all which handles field existence automatically
		# Search by patient_name (which should always exist)
		patients = frappe.get_all(
			"Patient",
			fields=["name", "patient_name"],
			filters={
				"patient_name": ["like", search_term]
			},
			or_filters=[
				["patient_name", "like", search_term],
			],
			order_by="patient_name asc",
			limit=50
		)
		
		# Try to add file_no if it exists (optional field)
		patient_meta = frappe.get_meta("Patient")
		has_file_no = any(f.fieldname == "file_no" for f in patient_meta.fields)
		
		if has_file_no:
			# Re-fetch with file_no field and add file_no to search
			patients = frappe.get_all(
				"Patient",
				fields=["name", "patient_name", "file_no"],
				filters={
					"patient_name": ["like", search_term]
				},
				or_filters=[
					["patient_name", "like", search_term],
					["file_no", "like", search_term],
				],
				order_by="patient_name asc",
				limit=50
			)
		
		return patients
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error searching Patients")
		frappe.throw(f"Failed to search Patients: {str(e)}")


@frappe.whitelist()
def get_pending_inpatient_medication_orders(patient: str):
	"""
	Get all pending Inpatient Medication Orders for a given Patient.
	Returns orders with their child table items (drug and dosage).
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
		
		# Fetch pending orders for the patient
		orders = frappe.get_all(
			"Patient Medication Order",
			fields=fields_to_fetch,
			filters={
				"patient": patient,
				"status": ["in", ["Pending", "Active"]]
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
			order["items"] = []
			
			# Get the doctype meta to find child tables
			order_meta = frappe.get_meta("Patient Medication Order")
			child_table_fields = []
			
			# Find all child table fields
			for field in order_meta.fields:
				if field.fieldtype == "Table":
					child_table_fields.append(field.fieldname)
			
			# Common fieldnames in healthcare (fallback if meta doesn't work)
			if not child_table_fields:
				child_table_fields = ["drug_prescription", "medication_orders", "items", "drugs", "drug_prescription_detail"]
			
			for fieldname in child_table_fields:
				if hasattr(order_doc, fieldname):
					child_table = getattr(order_doc, fieldname)
					if child_table and len(child_table) > 0:
						for item in child_table:
							# Get all available attributes
							item_dict = {}
							
							# Try different field names for drug/item_code
							if hasattr(item, "drug"):
								item_dict["drug"] = item.drug
							elif hasattr(item, "item_code"):
								item_dict["drug"] = item.item_code
							elif hasattr(item, "drug_code"):
								item_dict["drug"] = item.drug_code
							
							# Try different field names for drug_name
							if hasattr(item, "drug_name"):
								item_dict["drug_name"] = item.drug_name
							elif hasattr(item, "item_name"):
								item_dict["drug_name"] = item.item_name
							
							# Get dosage if available
							if hasattr(item, "dosage"):
								item_dict["dosage"] = item.dosage
							# Patient Frequency (Link to Prescription Frequency) - use for cart prescription frequency
							if hasattr(item, "patient_frequency") and item.patient_frequency:
								item_dict["patient_frequency"] = item.patient_frequency
							elif hasattr(item, "frequency") and item.frequency:
								item_dict["patient_frequency"] = item.frequency
							else:
								item_dict["patient_frequency"] = None
							
							# Get other optional fields
							if hasattr(item, "dosage_form"):
								item_dict["dosage_form"] = item.dosage_form
							
							if hasattr(item, "period"):
								item_dict["period"] = item.period

							if hasattr(item, "is_prn"):
								item_dict["is_prn"] = item.is_prn
							else:
								item_dict["is_prn"] = 0

							if hasattr(item, "medication_type"):
								item_dict["medication_type"] = item.medication_type
							else:
								item_dict["medication_type"] = None
							
							if hasattr(item, "quantity"):
								item_dict["quantity"] = item.quantity
							else:
								item_dict["quantity"] = 1
							
							# UOM from order entry (drug default/stock UOM)
							if hasattr(item, "uom"):
								item_dict["uom"] = item.uom
							else:
								item_dict["uom"] = None
							
							# Only add if we have a drug/item_code
							if item_dict.get("drug"):
								order["items"].append(item_dict)
						
						if order["items"]:
							break  # Found items, no need to check other fields
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

		# History excludes pending/active orders.
		orders = frappe.get_all(
			"Patient Medication Order",
			fields=fields_to_fetch,
			filters={
				"patient": patient,
				"status": ["not in", ["Pending", "Active"]],
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
			order["items"] = []

			child_table_fields = [f.fieldname for f in order_meta.fields if f.fieldtype == "Table"]
			if not child_table_fields:
				child_table_fields = ["drug_prescription", "medication_orders", "items", "drugs", "drug_prescription_detail"]

			for fieldname in child_table_fields:
				if hasattr(order_doc, fieldname):
					child_table = getattr(order_doc, fieldname)
					if not child_table:
						continue
					for item in child_table:
						item_dict = {}
						if hasattr(item, "drug"):
							item_dict["drug"] = item.drug
						elif hasattr(item, "item_code"):
							item_dict["drug"] = item.item_code
						elif hasattr(item, "drug_code"):
							item_dict["drug"] = item.drug_code

						if hasattr(item, "drug_name"):
							item_dict["drug_name"] = item.drug_name
						elif hasattr(item, "item_name"):
							item_dict["drug_name"] = item.item_name

						if hasattr(item, "dosage"):
							item_dict["dosage"] = item.dosage
						item_dict["patient_frequency"] = getattr(item, "patient_frequency", None) or getattr(item, "frequency", None)
						item_dict["dosage_form"] = getattr(item, "dosage_form", None)
						item_dict["period"] = getattr(item, "period", None)
						item_dict["is_prn"] = getattr(item, "is_prn", 0)
						item_dict["medication_type"] = getattr(item, "medication_type", None)
						item_dict["quantity"] = getattr(item, "quantity", 1) or 1
						item_dict["uom"] = getattr(item, "uom", None)

						if item_dict.get("drug"):
							order["items"].append(item_dict)
					if order["items"]:
						break

		return orders
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching Medication Order history")
		frappe.throw(f"Failed to fetch Medication Order history: {str(e)}")


@frappe.whitelist()
def create_patient_visit(patient: str):
	"""
	Create a patient visit-style document from POS.
	Tries Patient Visit first; falls back to Patient Encounter.
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
			doc.visit_type = "Pharmacy"

		doc.insert(ignore_permissions=True)
		if hasattr(doc, "submit"):
			try:
				doc.submit()
			except Exception:
				# Some healthcare setups keep visits as draft; allow that.
				pass

		return {
			"doctype": visit_doctype,
			"name": doc.name,
			"patient": patient,
			"patient_name": patient_name,
			"docstatus": doc.docstatus,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error creating Patient Visit")
		frappe.throw(f"Failed to create patient visit: {str(e)}")
