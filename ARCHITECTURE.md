# Architecture

This document describes how Tracepack is built and why, for anyone reading the code for the
first time. See [`README.md`](README.md) for what it does and how to run it, and
[`packages/evidence-interchange/SPEC.md`](packages/evidence-interchange/SPEC.md) for the
interchange contract specifically.

## Design principles

- **Local-first, no server.** There is no backend. Every project and evidence file lives in the
  browser's own IndexedDB storage until the user explicitly exports it. Nothing is uploaded
  anywhere by default. See [`SECURITY.md`](SECURITY.md) for the full trust model.
- **Show gaps, do not hide them.** A pack can be exported with missing required categories or
  unresolved privacy findings still visible. Tracepack records what is missing rather than
  blocking the user or pretending completeness it cannot verify.
- **Never silently mutate the original.** Redaction, title substitution, and rescanning always
  operate on a derived copy used for the export. The stored evidence item is never rewritten in
  place.
- **A hash proves integrity, not identity or truth.** Every export mentions this explicitly,
  both in the PDF and the JSON manifest, especially for evidence with external provenance. See
  `SECURITY.md` for what a `contentHash` actually proves.

## Repository layout

```
apps/
  workspace/    the web app (React + Vite). All product logic lives here or in packages/.
  extension/    a thin browser extension: page capture (viewport or full-page), shown in the
                popup with a pack picker so the user chooses whether and where to open it. It
                has no logic of its own beyond that.
packages/
  evidence-core/          domain model: EvidenceItem, TracepackProject, PrivacyFinding, and
                           the pure functions that operate on them (progress, category state).
  document-engine/        PDF text extraction, PII pattern detection, redaction geometry.
  export-engine/          builds the PDF pack, the JSON manifest, and the .tracepack bundle.
  storage/                IndexedDB persistence (projects and evidence file blobs).
  template-engine/        loads template.yaml definitions that shape a project's categories.
  evidence-sdk/           portable tracepack-evidence v1 types, schema validation and
                           canonicalisation used by external producers.
  evidence-interchange/   TracePack-internal import path for tracepack-evidence v1 payloads.
  attestation/            portable Attestation v1 model, canonicalisation, verification and
                           policy primitives.
  attestation-sigstore/   Sigstore signing and verification runtime for attestations.
  pack-attestation/       deterministic pack snapshots and pack-snapshot attestation subjects.
templates/
  consumer-complaint/     consumer complaint evidence template.
  provenance-trace/       provenance-oriented evidence template.
  general/                general-purpose evidence template.
  woocommerce-order-evidence/
                           WooCommerce order evidence template.
examples/
  producers/consumer-rights-helper/   a worked, independent implementation of a
                                       tracepack-evidence v1 producer, built with zero
                                       imports from Tracepack's own code.
```

Packages are separate pnpm workspace members with their own package metadata and validation
commands. Product-facing packages remain independent of `apps/workspace` and `apps/extension`,
while the portable developer packages are designed so their public contracts can be consumed
without importing the browser workspace.

`evidence-sdk` contains the portable `tracepack-evidence` contract implementation.
`evidence-interchange` is the TracePack-internal importer and can depend on product-side document
processing and storage. The attestation packages form another layered boundary:
`attestation` contains portable contract and policy primitives, `attestation-sigstore` supplies
the Sigstore runtime, and `pack-attestation` connects immutable TracePack pack snapshots to
attestation subjects.

## Data model

`TracepackProject` is the root object: a title, organisation, desired resolution, a snapshot of
the template it was created from, and a list of `EvidenceItem`s. An `EvidenceItem` is one
receipt, screenshot, PDF, or written note, with a `sourceType`, a SHA-256 `contentHash`, a
`reviewStatus`, and (if it came through the interchange contract) `provenance` and
`observations`. `PrivacyFinding`s are attached to an item, one per detected pattern (email,
phone, postcode, payment card, National Insurance number), each with its own keep/remove
decision.

This is all defined in `packages/evidence-core` with no framework dependency, so it can be
imported by `export-engine`, `evidence-interchange`, and any future non-React surface without
pulling in React.

## Data flow

**Capture and import.** Evidence enters a project three ways: a direct file upload, a browser
extension capture (a screenshot of the current tab, viewport or full page), or an interchange
import from an external producer -- either a third-party site handing off evidence live via the
`postMessage`-based "Send to Tracepack" embed contract (see
`packages/evidence-interchange/EMBED_GUIDE.md`), or a payload pasted in directly. Every path
converges on the same `EvidenceItem` shape before it reaches storage.

**Privacy review.** On import, `document-engine` extracts text from PDFs (via `pdfjs-dist`) and
scans it, the item's title, and its filename for the patterns above. Every match becomes a
`PrivacyFinding` with `decision: "unreviewed"`. A human must resolve every finding (keep or
remove) before that item can appear in an export; this gate is enforced once, centrally, in
`apps/workspace`'s export flow, not duplicated per export format.

**Redaction.** A finding marked "remove" is never deleted from the stored item. At export time,
a PDF page containing a location-anchored removal is rasterised to a flattened image (so the
underlying text is not recoverable, not just visually covered) before being placed in the
output PDF. A title or filename finding is handled differently: the matched text is substituted
wherever that field is rendered in an export artifact. The original file in storage and the
original `item.title` string are never modified either way.

**Export.** `export-engine` produces four artifacts from the same reviewed project: a PDF
evidence pack (cover, evidence index, one page or flattened image per item, an external
observations page for anything with provenance), a JSON manifest (hashes, source metadata, the
same producer-identity notice when relevant), a `.tracepack` bundle (a zip of the PDF and the
manifest together), and a `.epack` file conforming to the open
[Evidence Pack v1](https://github.com/locktivity/evidence-pack) container format -- a
`manifest.json` plus one embedded artifact under `artifacts/`. The `.epack` embeds the same
redacted PDF the other formats do, never the raw original attachment files: that format's
`artifacts/` folder is meant for the underlying evidence, but Tracepack's redaction guarantee
only ever covers the rendered PDF, not raw bytes, so embedding raw originals would put back
exactly the PII a reviewer approved removing. One malformed evidence file no longer aborts the
whole pack; it gets a clearly labelled "could not be included" page instead, and everything else
still exports.

## The `tracepack-evidence` interchange contract

An external tool (not Tracepack) can hand Tracepack structured evidence, its own hashes,
provenance, and claims, without Tracepack needing to trust that tool's implementation. This is
`packages/evidence-interchange`: a versioned JSON Schema, RFC 8785 canonicalization for hashing,
and an import path that runs the same privacy scanning as a native upload before anything
reaches storage. The contract is **frozen as of v1**; see `SPEC.md` in that package for why each
constraint exists, and `examples/producers/consumer-rights-helper` for what an independent,
zero-import implementation of a producer actually looks like.

Producer identity in this contract is self-asserted, not cryptographically verified. The
separate Attestation v1 system does not change that rule. An attestation can cryptographically
bind a Sigstore-authenticated signing identity to a statement about one immutable pack digest,
but it does not authenticate the `source.producer_id` declared by an interchange payload and
does not prove that the underlying evidence or observation is true.

The separation is deliberate: `tracepack-evidence` remains a portable evidence interchange
contract, while attestation is an independent trust layer over finalized pack state.

## Storage model

Everything lives in one IndexedDB database in the browser: `TracepackProject` records in one
object store, evidence file blobs in another, keyed by evidence item id. There is no server
round-trip anywhere in this path. `saveProjectAndFiles` in `packages/storage` is the one
transactional write used when a project and its new files must land together; older
single-record functions still exist for the paths that only ever touch one record at a time
rather than being replaced wholesale.

Storage failures (quota exceeded, storage blocked entirely, e.g. some private browsing modes)
are surfaced to the user with a specific, actionable message rather than failing silently,
especially on delete.

## Browser extension

The extension is deliberately thin. Its only job is page capture: the user clicks the toolbar
icon, the content script captures the visible viewport or stitches a full-page screenshot, and
the result is shown right there in the popup (thumbnail, download link) rather than immediately
opening a tab. The popup reads the same IndexedDB the workspace app uses (they share an origin)
to offer a pack picker; picking one navigates straight to that pack's workspace with the capture
already imported as evidence, and the user can create a new pack instead if none fits. Nothing
opens automatically until the user chooses. All evidence handling, review, and export logic
lives in `apps/workspace`, loaded by the extension rather than duplicated inside it. See
`apps/extension/e2e/CHROME_EDGE_CHECKLIST.md` for what still requires manual verification on a
real browser (toolbar interaction, permission prompts, Edge-specific behaviour) beyond what the
automated `e2e` script covers.

## What is not built yet

This section exists so nothing here is assumed by accident:

- No account, no sync, no server-side storage of any kind.
- No automatic authentication of `tracepack-evidence` producer identity. Producer identity in
  the interchange contract remains self-asserted. TracePack does provide a separate cryptographic
  Attestation v1 layer for signed statements about immutable pack digests; see `SECURITY.md` and
  `packages/attestation/SPEC.md`.
- No hosted or shared pack: the "Send to Tracepack" embed button (see
  `packages/evidence-interchange/EMBED_GUIDE.md`) hands evidence into the customer's own local
  pack only. A page both sides can see, email delivery, and a copy retained on the sending
  business's own systems would need real server infrastructure Tracepack doesn't have.
- No OCR. Image-only PDF pages are not scanned for text or PII.
- Full physical browser verification (real Chrome and Edge, real toolbar and permission
  prompts) is a manual step tracked in `apps/extension/e2e/CHROME_EDGE_CHECKLIST.md`; automated
  coverage stops at what a headless browser can exercise.
