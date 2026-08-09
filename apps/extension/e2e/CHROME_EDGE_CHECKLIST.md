# Chrome / Edge manual testing checklist

Run this before any release that touches `apps/extension`, `apps/workspace`,
or the document/export engines. `pnpm --filter @tracepack/extension e2e`
automates the core detect-review-redact-export journey inside Chromium and
should pass first -- this checklist covers what that script cannot reach:
real browser installs, human interaction (toolbar clicks, permission
prompts), Edge specifically, and visual/UX review.

## Setup

- [ ] `pnpm --filter @tracepack/extension build`
- [ ] Load `apps/extension/dist` as an unpacked extension in the target browser
      (`chrome://extensions` or `edge://extensions`, Developer mode on, **Load unpacked**)
- [ ] No console errors on load (`chrome://extensions` → **Errors** button, if shown)

## Capture flow (cannot be automated -- requires a real toolbar click)

- [ ] Click the Tracepack toolbar icon on a normal `https://` page → popup shows "Capture this page"
- [ ] Click **Capture visible page** (or **Capture full page**) → popup shows the screenshot, a download link, and (if any packs exist) a pack picker -- no tab opens automatically
- [ ] With existing packs: clicking one in the picker opens a new tab directly on that pack's workspace, with the capture already imported as evidence
- [ ] With no existing packs: the fallback button reads "Add to a Tracepack project" and opens a new tab on the workspace home screen instead
- [ ] Popup shows a clear error on a restricted page (e.g. `chrome://extensions` itself, or a PDF viewer tab)
- [ ] Capturing a very tall/wide page produces a usable screenshot (no black bars, no truncation)
- [ ] Repeated captures on the same page each produce a distinct pending capture (no silent overwrite)

## Project and evidence

- [ ] Create a project, reopen it from the home screen after closing the tab
- [ ] Import a real multi-page PDF with a text layer -- text extraction completes, no console errors
- [ ] Import a scanned/image-only PDF -- "No text layer" warning shown, no crash
- [ ] Import a JPG, PNG, and WebP file -- all three import; WebP shows the "not embedded in PDF" note at export
- [ ] Import a corrupted/non-PDF file renamed to `.pdf` -- fails gracefully with a message, not a crash

## Privacy review

- [ ] A document containing an email, a UK postcode, and a UK NI number produces three separate findings
- [ ] A finding's "Mark for removal" button is enabled (has a location) for normal text
- [ ] Marking a finding "Keep" vs "Remove" persists after navigating away and back
- [ ] A finding whose value spans a visible line-wrap or hyphenation in the source PDF is still detected

## Export

- [ ] Export with at least one "Remove" decision → the downloaded PDF opens correctly in a PDF viewer
- [ ] Open the exported PDF and confirm the redacted region is visually blacked out, not just visually covered
      (try selecting text on that page -- nothing should be selectable/copyable on the flattened page)
- [ ] Export with zero removals → original PDF pages are byte-identical in content (no unnecessary flattening)
- [ ] Download the JSON manifest and confirm the SHA-256 hash for one item matches a manual hash of the original file
- [ ] Export a project with unresolved ("unreviewed") findings → warning banner appears and export still proceeds
- [ ] Download the `.epack` file, extract it with a real archive tool (not just this repo's own
      code), and confirm: `manifest.json` + `artifacts/evidence-pack.pdf` are the only two
      entries, `spec_version` is `"1.0"`, and the embedded PDF opens correctly
- [ ] If you have access to Locktivity's own `epack` CLI or verifier, run it against a
      Tracepack-produced `.epack` file and confirm it validates -- this repo's own tests
      independently reproduce the pack_digest algorithm, but nothing here has been checked
      against the real reference implementation yet

## Storage and recovery

- [ ] Close the browser mid-import (large file) and reopen -- project is not left in a half-imported state that crashes on open
- [ ] Delete a project → its files are gone from IndexedDB (Application panel → IndexedDB in DevTools)
- [ ] Fill storage close to quota (large files) and confirm the app surfaces an error rather than silently failing

## Edge-specific

- [ ] Repeat "Capture flow" and "Export" above in Edge specifically -- layout, download prompts, and permission
      dialogs can differ from Chrome
- [ ] Edge's PDF preview / download-blocked-by-SmartScreen behavior does not prevent saving the evidence pack

## Do not use with real sensitive evidence until this checklist has passed on both browsers.
