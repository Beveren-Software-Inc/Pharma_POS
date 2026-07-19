"""Clinical safety checks surfaced at the point of dispensing (BRD PHA-02).

Two advisory checks are provided:

* **Drug-allergy** – the drug being dispensed is matched against the patient's recorded
  allergy note (``Patient.allergies``, a free-text field). "No known allergy" style notes
  are recognised and ignored.
* **Duplicate therapy** – the same drug appearing more than once in a single dispense.

Alerts are *advisory* – they warn the pharmacist and are recorded on the invoice for audit,
but they do not hard-block dispensing (the prescriber/pharmacist makes the final call).
"""

import json

import frappe
from frappe import _

# Notes that mean "no allergy" – do not mine these for drug tokens.
_NO_ALLERGY_PREFIXES = (
	"nkda",
	"nka",
	"no known drug allerg",
	"no known allerg",
	"not known to have any allerg",
	"not known to have allerg",
	"no allerg",
	"no known",
	"not allergic",
	"non allergic",
	"not reported",
	"non reported",
	"not report",
	"nil known",
	"nil",
	"none",
	"n/a",
	"na ",
	"denies any allerg",
	"denies allerg",
)

# Common words in an allergy note that are not drug names.
_ALLERGY_STOPWORDS = {
	"with",
	"allergy",
	"allergic",
	"allergies",
	"drug",
	"drugs",
	"known",
	"reaction",
	"history",
	"patient",
	"food",
	"seasonal",
	"anaphylactic",
	"anaphylaxis",
}


def _normalise_items(items):
	if isinstance(items, str):
		try:
			items = json.loads(items)
		except Exception:
			items = []
	if not isinstance(items, list):
		return []
	return [it for it in items if isinstance(it, dict)]


def _patient_allergy_note(patient):
	"""Return a lowercased allergy note for the patient, or '' when there is no real allergy."""
	if not patient or not frappe.db.exists("Patient", patient):
		return ""
	raw = (frappe.db.get_value("Patient", patient, "allergies") or "").strip()
	if not raw:
		return ""
	stripped = raw.lower().replace(".", " ").strip()
	for neg in _NO_ALLERGY_PREFIXES:
		if stripped == neg or stripped.startswith(neg):
			return ""
	return raw.lower()


def _drug_haystack(item):
	"""Lowercased text that identifies a cart drug (code + item name + drug name)."""
	parts = set()
	code = (item.get("id") or item.get("item_code") or "").strip()
	if code:
		parts.add(code.lower())
		item_name = frappe.db.get_value("Item", code, "item_name")
		if item_name:
			parts.add(item_name.lower())
	for key in ("drug_name", "item_name", "name"):
		val = (item.get(key) or "").strip()
		if val:
			parts.add(val.lower())
	return " ".join(parts)


def check_dispense_safety(patient=None, items=None):
	"""Return drug-allergy and duplicate-therapy alerts for a dispensing cart.

	Result: ``{"has_alerts": bool, "alerts": [{type, severity, item_code, drug, message}, ...]}``
	"""
	items = _normalise_items(items)
	alerts = []

	# --- Drug-allergy: does any dispensed drug appear in the patient's allergy note? ---
	allergy_note = _patient_allergy_note(patient)
	if allergy_note:
		tokens = [w.strip(",.;:()/-") for w in allergy_note.replace("/", " ").split()]
		allergy_terms = [
			w for w in tokens if len(w) >= 4 and w not in _ALLERGY_STOPWORDS
		]
		for it in items:
			hay = _drug_haystack(it)
			if not hay:
				continue
			hit = next((w for w in allergy_terms if w in hay), None)
			if hit:
				drug = it.get("drug_name") or it.get("item_name") or it.get("id") or it.get("item_code")
				alerts.append(
					{
						"type": "allergy",
						"severity": "high",
						"item_code": (it.get("id") or it.get("item_code") or ""),
						"drug": drug,
						"message": _(
							"Patient is recorded as allergic to '{0}' — {1} may be contraindicated."
						).format(hit, drug),
					}
				)

	# --- Duplicate therapy: same drug more than once in the cart ---
	counts = {}
	for it in items:
		code = (it.get("id") or it.get("item_code") or "").strip()
		if code:
			counts[code] = counts.get(code, 0) + 1
	for code, n in counts.items():
		if n > 1:
			drug = frappe.db.get_value("Item", code, "item_name") or code
			alerts.append(
				{
					"type": "duplicate",
					"severity": "medium",
					"item_code": code,
					"drug": drug,
					"message": _(
						"{0} appears {1} times in this dispense — check for duplicate therapy."
					).format(drug, n),
				}
			)

	return {"has_alerts": bool(alerts), "alerts": alerts}


@frappe.whitelist()
def check_dispense_safety_api(patient=None, items=None):
	"""Whitelisted wrapper so the POS UI can pre-check a cart before dispensing."""
	return check_dispense_safety(patient=patient, items=items)


def record_dispense_alerts(invoice_doc, items):
	"""Non-blocking: attach any clinical alerts to the invoice as an audit comment."""
	try:
		from klik_pos.api.patient import resolve_patient_from_customer

		patient = resolve_patient_from_customer(getattr(invoice_doc, "customer", None))
		if not patient:
			return
		result = check_dispense_safety(patient=patient, items=items)
		if not result.get("has_alerts"):
			return
		lines = "\n".join("• " + a["message"] for a in result["alerts"])
		invoice_doc.add_comment(
			"Comment",
			_("Clinical alerts at dispensing:") + "\n" + lines,
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "record_dispense_alerts failed")
