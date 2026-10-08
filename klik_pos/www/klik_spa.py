import frappe

no_cache = 1


def get_context(context):
	"""Expose the session CSRF token to the POS page.

	``frappe.session.csrf_token`` is not populated (the token lives on
	``frappe.session.data``). Rendering that attribute put ``window.csrf_token =
	"None"`` in the page, so POSTs such as employee dispense were rejected with
	CSRFTokenError.
	"""
	csrf_token = frappe.sessions.get_csrf_token()
	# Guest sessions are not persisted. Logged-in tokens must be stored before
	# the browser's next POST, otherwise the header will not match.
	if frappe.session.user != "Guest":
		frappe.db.commit()
	context.csrf_token = csrf_token or ""
	return context
