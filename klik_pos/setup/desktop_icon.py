# Copyright (c) 2026, KLiK PoS and contributors
# For license information, please see license.txt

"""
Keep the KLiK PoS tile on the icon this app ships, on every site.

A site draws the KLiK PoS icon through one of two paths, depending on
``Desktop Settings.desktop_page`` (the setting is per site, not per user):

* ``Apps`` - the screen is built from the ``add_to_apps_screen`` hook in ``hooks.py``, and the
  ``logo`` it names is drawn in a 54x54 box with the image stretched to fill it. That hook used
  to name ``ROSE_LOGO.png``, a customer wordmark 804x180, so the box turned it into an
  unreadable smear - on every site, since the file is the same one.
* ``Desktop Icons`` - the screen is built from ``Desktop Icon`` rows instead. The row for an app
  is seeded once, at install time, by ``create_desktop_icons_from_installed_apps`` (which copies
  the hook's ``logo`` into ``logo_url``) and is never re-synced afterwards. So a site installed
  before the hook named the right artwork keeps the old ``logo_url`` for good, and a site whose
  row was patched by hand (or by another app) keeps *that* image.

``hooks.py`` fixes the first path and every row seeded from now on. This function repairs the
rows that already exist, so a site picks the icon up on its next ``bench migrate`` without
anyone editing the ``Desktop Icon`` form by hand.

Note that the grid itself prefers ``public/icons/desktop_icons/<style>/klik_pos.svg`` over
``logo_url`` (see ``desktop_icons_item.html``), which is why this app ships both styles as well:
the shipped file is what paints the tile, and ``logo_url`` is the fallback for a style this app
does not ship. Both carry the same mark, so the two cannot disagree.

Wired up as ``after_install`` and ``after_migrate``. Idempotent, and it does nothing on a site
in ``Apps`` mode, which holds no ``Desktop Icon`` rows at all.
"""

import frappe

#: The mark, as a path the desk can load. Bump the ``?v=`` token whenever the artwork changes:
#: ``/assets`` files are served with long cache headers and the file name stays the same.
APP_ICON_URL = "/assets/klik_pos/images/klik_pos_icon.svg?v=1"

#: ``Desktop Icon`` is autonamed from ``label``, so the docname of the app's tile is the title.
DESKTOP_ICON_LABEL = "KLiK PoS"


def sync_klik_pos_desktop_icon():
	"""Point the KLiK PoS ``Desktop Icon`` row at the icon this app ships."""
	if not frappe.db.exists("Desktop Icon", DESKTOP_ICON_LABEL):
		return

	if frappe.db.get_value("Desktop Icon", DESKTOP_ICON_LABEL, "logo_url") == APP_ICON_URL:
		return

	frappe.db.set_value("Desktop Icon", DESKTOP_ICON_LABEL, "logo_url", APP_ICON_URL)

	# Commit before dropping the cache: a later `after_migrate` hook that raises rolls the migrate
	# back, and the cache must not be cleared for a value that never landed. (`set_value` bumps
	# `modified` too, which is what the desk keys its own caches on.)
	frappe.db.commit()

	# The rows are read out of a per-user cache (`frappe.cache.hget("desktop_icons", user)`), so
	# the new artwork only reaches a user once that hash is gone.
	frappe.cache.delete_key("desktop_icons")
