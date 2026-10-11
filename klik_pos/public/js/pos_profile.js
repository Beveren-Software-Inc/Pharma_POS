frappe.ui.form.on("POS Profile", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.warehouse) {
			return;
		}

		frm.add_custom_button(__("Clear Phantom Stock"), () => {
			frappe.confirm(
				__(
					"Set the stock quantity for {0} to the stock ledger balance? Items with no ledger quantity will show as 0 on the POS.",
					[frm.doc.warehouse]
				),
				() => {
					frappe.call({
						method: "klik_pos.api.pos_profile.clear_phantom_stock",
						args: { pos_profile: frm.doc.name },
						freeze: true,
						freeze_message: __("Checking warehouse stock..."),
						callback(r) {
							const message = (r.message && r.message.message) || __("Done");
							frappe.msgprint({
								title: __("Phantom Stock"),
								message,
								indicator: r.message && r.message.cleared ? "green" : "blue",
							});
						},
					});
				}
			);
		});
	},
});
