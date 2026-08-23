=== TracePack for WooCommerce ===
Contributors: ace202
Tags: woocommerce, evidence, orders, disputes, records
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Create a portable evidence record from a WooCommerce order and review it in TracePack before anything is added.

== Description ==

TracePack for WooCommerce lets an authorised WooCommerce administrator create a portable evidence record from an order.

From the WooCommerce order screen, choose **Send to TracePack**. The plugin prepares selected order information and opens TracePack in a browser tab for review.

Nothing is added to TracePack until you review and confirm the handoff.

The first release includes:

* Order reference
* Order creation date
* Order status
* Currency
* Product line items
* Subtotal
* Discount total
* Shipping total
* Tax total
* Order total
* Payment method title
* Transaction reference when available
* Paid date when available
* Shipping methods when available
* Completed date when available

The first release deliberately does not include:

* Customer email address
* Customer phone number
* Billing address
* Shipping address
* Full payment-card details
* Credentials or secrets
* Arbitrary WooCommerce order metadata

TracePack for WooCommerce uses WooCommerce public order APIs and supports WooCommerce High-Performance Order Storage (HPOS).

== External Service ==

This plugin integrates with TracePack at app.tracepack.org.

The service is used only when an authorised WooCommerce user selects **Send to TracePack** and confirms the action.

At that point, the plugin prepares an evidence payload containing the selected WooCommerce order information described above. The payload is handed to the user's TracePack browser tab so that it can be reviewed before import.

The plugin does not automatically upload WooCommerce orders in the background.

The plugin does not send evidence to TracePack when simply browsing or editing an order.

No TracePack account is required for the current browser-local workflow.

TracePack:
https://tracepack.org/

Privacy information:
https://tracepack.org/privacy

== Installation ==

1. Install and activate WooCommerce.
2. Install and activate TracePack for WooCommerce.
3. Open a WooCommerce order in the WordPress admin.
4. Find the TracePack panel.
5. Select **Send to TracePack**.
6. Confirm that you want to open the order in TracePack.
7. Review the evidence in TracePack.
8. Confirm the import if you want to add it.

== Frequently Asked Questions ==

= Does TracePack automatically upload my WooCommerce orders? =

No. The plugin only prepares an evidence record after an authorised user selects **Send to TracePack**.

Nothing is added to TracePack until the user reviews and confirms the handoff in TracePack.

= Does the plugin send customer addresses or contact details? =

Not in version 0.1.0.

The first release deliberately excludes customer email addresses, phone numbers, billing addresses and shipping addresses.

= Does it include payment-card information? =

No. Full card details, credentials and secrets are not included.

The evidence record may include the WooCommerce payment method title and transaction reference when available.

= Does it support HPOS? =

Yes. The plugin uses WooCommerce order APIs and declares compatibility with High-Performance Order Storage.

= Do I need a TracePack account? =

No account is required for the current browser-local TracePack workflow.

= What happens after I select Send to TracePack? =

The plugin prepares the order evidence and opens TracePack. You review the evidence and decide whether to confirm the import.

== Screenshots ==

1. TracePack panel on a WooCommerce order.
2. Confirmation before opening TracePack.
3. External evidence review with the WooCommerce order evidence template suggested.
4. Created WooCommerce evidence pack showing provenance and readiness.

== Source Code ==

The plugin includes a browser bundle used for the TracePack handoff.

Human-readable source for the handoff is maintained as part of the TracePack integration source and the release package includes the corresponding source required to review and reproduce the bundled JavaScript.

Build instructions are provided with the source files.

== Changelog ==

= 0.1.0 =

* Initial release.
* Add TracePack panel to WooCommerce orders.
* Create portable tracepack-evidence v1 order records.
* Add deliberate browser handoff to TracePack.
* Suggest the WooCommerce order evidence template.
* Add HPOS compatibility.
* Add capability and nonce protection.
