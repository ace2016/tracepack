# TracePack for WooCommerce

TracePack for WooCommerce creates a portable evidence record from a WooCommerce order and opens it in TracePack for review.

The integration uses the `tracepack-evidence` v1 contract and a deliberate browser handoff. Nothing is added to TracePack until the user reviews and confirms the import.

## Flow

```text
WooCommerce order
  -> Send to TracePack
  -> order snapshot
  -> tracepack-evidence v1 payload
  -> browser handoff
  -> WooCommerce order evidence template suggested
  -> human review in TracePack
```

## What is included

Version 0.1.0 includes:

- order reference
- created date
- order status
- currency
- product line items
- subtotal
- discount total
- shipping total
- tax total
- order total
- payment method title
- transaction reference when available
- paid date when available
- shipping methods when available
- completed date when available

## What is not included

The first release deliberately excludes:

- customer email address
- customer phone number
- billing address
- shipping address
- full payment-card details
- credentials or secrets
- arbitrary WooCommerce order metadata

## Security and privacy

- order data is read through WooCommerce public APIs
- HPOS is supported
- the AJAX endpoint requires the `edit_shop_orders` capability
- requests use an order-specific WordPress nonce
- order IDs are validated before `wc_get_order()`
- no server-to-server evidence upload is used
- nothing is added to TracePack until the user confirms the import
- TracePack validates the received evidence payload before use

WordPress nonces provide CSRF protection. Capability checks remain the authorisation boundary.

## Evidence template

The integration suggests `woocommerce-order-evidence`.

The template is available at `templates/woocommerce-order-evidence/template.yaml`.

The template suggestion is advisory. The user can choose another template before creating the pack.

## Browser handoff source

The plugin ships the browser build of the TracePack integration library locally rather than loading it from a CDN.

Human-readable source used to reproduce that bundle is included under `source/tracepack-integration/`.

See `source/tracepack-integration/BUILD.md` for build instructions.

## WordPress plugin

The installable WordPress plugin is **TracePack for WooCommerce**.

Current release version: **0.1.0**.

The plugin directory also contains the WordPress.org `readme.txt`, licensing files, tests and bundle source.
