import frappe
from frappe.exceptions import DoesNotExistError

OLD_LABELS = ("KLiK PoS", "KLIK POS", "Klik POS")


def execute():
	"""Rename the desk tile and workspace to Pharma POS.

	The app id and the Frappe module stay ``klik_pos``. That module name is
	what the DocType package on disk is built from, so it is not renamed.
	"""
	_rename("Workspace", "Klik POS", "Pharma POS")
	_rename("Desktop Icon", "KLiK PoS", "Pharma POS")
	frappe.db.sql(
		"""UPDATE `tabWorkspace` SET title = 'Pharma POS'
		WHERE name = 'Pharma POS' AND title IN %(old)s""",
		{"old": OLD_LABELS},
	)
	for table in ("tabWorkspace Shortcut", "tabWorkspace Link"):
		frappe.db.sql(
			f"UPDATE `{table}` SET label = 'Pharma POS' WHERE label IN %(old)s",
			{"old": OLD_LABELS},
		)
	frappe.db.sql(
		"""UPDATE `tabWorkspace`
		SET content = REPLACE(content, 'Klik POS', 'Pharma POS')
		WHERE name = 'Pharma POS'"""
	)


def _rename(doctype, old, new):
	try:
		frappe.rename_doc(
			doctype,
			old,
			new,
			force=True,
			merge=bool(frappe.db.exists(doctype, new)),
			show_alert=False,
		)
	except DoesNotExistError:
		return
