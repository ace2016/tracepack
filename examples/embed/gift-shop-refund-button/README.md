# Example: "Send to Tracepack" refund button

A single, framework-free HTML file -- no build step, no npm install -- showing the full "Send to
Tracepack" embed contract: a third-party site opens Tracepack's hosted workspace app in a new
tab and hands off a `tracepack-evidence` v1 payload via `postMessage`. See
[`../../../packages/evidence-interchange/EMBED_GUIDE.md`](../../../packages/evidence-interchange/EMBED_GUIDE.md)
for the full protocol this implements.

No browser extension is required. This opens a plain `https://` page
(`https://app.tracepack.org`) and talks to it with `window.postMessage` -- the same mechanism
any two browser tabs can use to talk to each other, nothing extension-specific involved.

## Try it

1. Serve [`index.html`](index.html) from a real `http://` origin (`python3 -m http.server`, or
   any static server) -- a page can't `window.open()` another origin reliably from a `file://`
   URL, so open it as a served page, not by double-clicking the file.
2. Click "Send to Tracepack." It opens `https://app.tracepack.org/?send-to-tracepack=1` in a new
   tab and sends the payload once that tab signals it's ready.
3. To run this against a local build instead of the real hosted app, change `TRACEPACK_URL` in
   `index.html` to wherever you're running `apps/workspace` locally (e.g.
   `http://localhost:5173/?send-to-tracepack=1` from `pnpm --filter @tracepack/workspace dev`).

## What this demonstrates

- Opening Tracepack's hosted app in a new tab with `?send-to-tracepack=1` -- no install-detection
  step first, because there's nothing to detect: a plain URL either loads or it doesn't, the same
  as any other link.
- The `ready` / `evidence` / `imported` `postMessage` handshake.
- Building a minimal, valid `tracepack-evidence` v1 payload (an observation-only claim, no file
  attachment -- see the code comments for why, and where a real receipt photo would go).
- Handling a blocked popup gracefully instead of failing silently.
- **A permanent download-as-file option**, not just an error fallback: some customers will
  prefer a file they can add later over a tab opening automatically. The downloaded `.json` file
  can be picked up later through Tracepack's own external-import screen, which has a matching
  "upload a file" option next to its paste box specifically for this.

## What this deliberately does NOT demonstrate

- Real RFC 8785 canonicalization or SHA-256 hashing via a proper library -- this file hand-rolls
  a minimal version inline because it has no build step. **Use
  [`@tracepack/evidence-sdk`](../../../packages/evidence-sdk/README.md) for this in a real
  integration.**
- Server-side payload construction. A real refund/deposit form should build and hash the
  payload on your own backend (trusted), not entirely in the customer's browser (which they
  could tamper with before Tracepack ever reviews it) -- see the EMBED_GUIDE for why.
- Anything involving a shared/hosted pack, email delivery, or a copy saved on the business's own
  side. That's a real server-side feature, not built yet -- see EMBED_GUIDE's "What this is not"
  section.
