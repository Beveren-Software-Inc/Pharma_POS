import frappe
from frappe import _

from klik_pos.klik_pos.utils import clear_pos_profile_cache


@frappe.whitelist(allow_guest=True)
def clear_backend_cache():
	"""
	Clear backend cache including POS profile cache.
	This should be called when frontend cache is cleared to ensure consistency.
	"""
	try:
		# Clear POS profile cache
		clear_pos_profile_cache()

		frappe.logger().info("🧹 Backend cache cleared successfully")

		return {"success": True, "message": "Backend cache cleared successfully"}

	except Exception as e:
		frappe.logger().error(f"Error clearing backend cache: {frappe.get_traceback()}")
		return {"success": False, "error": str(e)}
