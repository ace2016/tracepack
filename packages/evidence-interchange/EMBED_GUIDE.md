# Embedding a "Send to Tracepack" button

A practical guide for a developer who wants a button on their own site -- a gift shop's refund
form, a housing site's deposit-claim page -- that hands evidence straight to a customer's own
Tracepack pack, in one click, with no server of Tracepack's own involved anywhere in the path.

If you want the payload format itself (what to put in `attachments`, `observations`, etc.), read
[`PRODUCER_GUIDE.md`](PRODUCER_GUIDE.md) instead -- this document is about *transport*: how a
payload you've already built gets from your page into Tracepack's. A complete, working,
framework-free example lives at
[`examples/embed/gift-shop-refund-button/`](../../examples/embed/gift-shop-refund-button/).

## 1. What this is, and what it deliberately is not

**What it is:** your page opens Tracepack in a new tab and posts a `tracepack-evidence` v1
payload to it via `window.postMessage`. The payload moves directly from your tab to the
customer's -- nothing touches a server, Tracepack's own or yours. The customer reviews it and
adds it to a pack that lives entirely in their own browser, same as if they'd typed it in by
hand.

**What it is not -- a shared or hosted pack.** There is no page both you and the customer can see,
no email delivery, and no copy saved on your own systems. That's a real, separate feature
(closer to a DocuSign-style hosted flow) that needs actual server infrastructure Tracepack
doesn't have yet. If you need that, it isn't built -- don't design a launch around it existing.

## 2. Getting a Tracepack URL to open

Open Tracepack's hosted workspace app directly -- no browser extension involved:

```
https://app.tracepack.org/?send-to-tracepack=1
```

That's it. No extension id to look up, no per-browser detection step, nothing to hardcode beyond
the URL itself. A plain link either loads or it doesn't, the same as any other link on the web --
there's nothing to check for in advance the way there was when the only way to reach Tracepack
was through an installed browser extension. (An earlier revision of this guide had a whole
extension-detection step here, using `externally_connectable` to ping the extension before
trying to open it. That entire step existed only because the destination used to require an
extension. It doesn't anymore, so it's gone -- if you're integrating fresh, ignore any reference
to `pingExtension` or extension ids you might see in old copies of this guide or example.)

`?send-to-tracepack=1` is the only thing that matters in the URL -- it tells Tracepack to show the
external-import screen instead of the normal home screen.

**This is still local-first -- hosting the app's static files is not the same as Tracepack
running a server in the evidence path.** `app.tracepack.org` serves the same client-side code
this repository builds from `apps/workspace`; once it loads in the visitor's browser, everything
from that point on -- storage, review, redaction, export -- runs exactly the same as it does
today when that code is loaded from an installed extension instead. The hosting serves files,
the same category of trust as the Chrome Web Store hosting the extension's files; it never sees
evidence, payloads, or anything sent over the `postMessage` handshake below, which goes directly
from your tab to the customer's, browser to browser.

Tracepack's own browser extension still exists and still does its own thing (page capture from
the toolbar) -- it's just no longer part of this specific flow. A visitor doesn't need it
installed for a "Send to Tracepack" button to work.

## 3. The handshake

Three message types, all namespaced under `source: "tracepack"` (from Tracepack to you) or
`source: "tracepack-producer"` (from you to Tracepack), so this never collides with unrelated
`postMessage` traffic on either page:

```
you                                    Tracepack's tab
 |--- window.open(tracepackUrl) ------->|
 |                                      | (loads, mounts the external-import screen)
 |<--- { source: "tracepack",          -|
 |       type: "ready" } --------------|
 |                                      |
 |--- { source: "tracepack-producer",  ->|
 |       type: "evidence",              |
 |       payload: {...} } -------------->| (validates, shows a review screen)
 |                                      |   user picks a pack, or starts a new one
 |<--- { source: "tracepack",          -|
 |       type: "imported",              |
 |       projectId, evidenceCount } ----|
```

Wait for `ready` before sending `evidence` -- the new tab needs a moment to load and mount its
message listener; sending immediately after `window.open()` can race that.

```js
const tracepackTab = window.open(tracepackUrl, "_blank");
if (!tracepackTab) { /* popup blocked -- tell the user to allow popups and retry */ }

window.addEventListener("message", (event) => {
  if (!event.data || event.data.source !== "tracepack") return;
  if (event.data.type === "ready") tracepackTab.postMessage({ source: "tracepack-producer", type: "evidence", payload }, "*");
  if (event.data.type === "imported") { /* your own UI: "Sent!" */ }
});
```

`imported` is best-effort -- if the customer just closes the tab without ever picking a pack,
you'll never receive it. Don't build anything that assumes it always arrives.

## 3a. Or, use `@tracepack/integration` instead of hand-rolling this

The handshake above is the whole protocol, and hand-rolling it yourself is completely fine. If
you'd rather not maintain your own `postMessage` listener, timeout handling, and status tracking,
[`@tracepack/integration`](../integration/README.md) wraps the same handshake behind two
functions, plus a few extras: explicit origin checks, a unique handoff id per send, protocol
version negotiation, and structured `accepted`/`rejected`/`cancelled` lifecycle messages instead
of a single best-effort `imported`.

```js
import { createTracepackHandoff, startTracepackBrowserHandoff } from "@tracepack/integration";

const handoff = createTracepackHandoff({
  evidencePayload: payload,
  context: { purpose: "support_case" },
});

const session = startTracepackBrowserHandoff({
  tracepackUrl,
  targetWindow: tracepackTab, // open this synchronously in your click handler, same as above
  handoff,
  onStatus(message) {
    // message.type: "accepted" | "rejected" | "cancelled"
  },
});

const imported = await session.completion; // resolves once Tracepack imports the evidence
```

Install with `npm install @tracepack/integration`; see its README for the full API. This is the
protocol Tracepack's own FreeScout integration uses, and new integrations should prefer it going
forward -- the plain handshake in section 3 above remains supported for existing producers and
anyone who wants zero dependencies, but isn't where new development is focused.

## 4. Building the payload

Use [`@tracepack/evidence-sdk`](../evidence-sdk/README.md) -- it has the types, schema
validation, and RFC 8785 hashing already built and tested, so you don't hand-roll it (see the
example's README for exactly why hand-rolling it, as that example does for its own no-build-step
reasons, is a worse choice for anything real). The payload shape itself is
[`PRODUCER_GUIDE.md`](PRODUCER_GUIDE.md)'s job to explain, not this document's.

**Build it server-side if you can.** A payload built entirely in the customer's browser can be
tampered with before Tracepack ever sees it -- not a security hole in Tracepack (it independently
scans and validates everything regardless), but it does mean whatever your button sends is only
as trustworthy as client-side code can be. A refund/deposit claim your own backend assembles and
hands to the browser just to forward is a stronger story than one built entirely client-side.

## 5. Trust and security notes

- **Producer identity is self-asserted**, exactly like the rest of the interchange contract (see
  `SPEC.md` §5). Tracepack doesn't verify who you are -- the `postMessage` origin isn't checked
  against an allowlist either, since there's no way to pre-register every site that might embed
  this button. This is a deliberate, existing trust boundary, not a new weaker one introduced by
  the embed mechanism.
- Any postMessage that isn't shaped like `{ source: "tracepack-producer", type: "evidence", ... }`
  is silently ignored by Tracepack's tab (not an error) -- unrelated `postMessage` traffic on the
  same page (an ad script, a browser extension) won't trigger anything.
- A crafted or malformed payload never gets past structural validation -- the customer sees a
  clear error, nothing is imported. See `PRODUCER_GUIDE.md` §7 for the error table.
- Any PDF attachment still goes through Tracepack's own PII scan before export, exactly like a
  manually uploaded file -- you can't opt a customer's evidence out of that review.
- Because this now opens a plain `https://` page rather than an extension URL, the fingerprinting
  surface an earlier revision of this guide noted (any site being able to ping the extension to
  check whether a visitor had it installed) no longer exists for this flow -- there's nothing to
  ping. Opening a URL reveals nothing about the visitor beyond what any `window.open()` to any
  site already would.

## 6. Popup blockers

`window.open()` triggered from a direct click (not from a `setTimeout`, a promise callback, or
anything not directly inside the click handler) is allowed by every major browser's popup
blocker. If you see it blocked anyway, check that nothing async runs between the click and the
`window.open()` call -- see the worked example for the exact pattern, including the user-facing
message to show if it's blocked regardless.
