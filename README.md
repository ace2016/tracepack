# Tracepack

Tracepack is a local-first, open-source tool for building a clear evidence pack from scattered
files (receipts, screenshots, PDFs, written notes) with privacy review built in before
anything leaves your browser.

There's no account, no server, and no cloud upload. Your projects live in your browser's local
storage until you choose to export them.

Try it at [app.tracepack.org](https://app.tracepack.org) -- no install required. The browser
extension (below) adds page capture on top of the same app; [dev.tracepack.org](https://dev.tracepack.org)
and [docs.tracepack.org](https://docs.tracepack.org) cover the SDK/CLI and the rest of the docs.

## What it does today

- **Collect evidence**: upload PDFs, images, or write notes directly; capture a webpage via
  the browser extension (viewport or full-page).
- **Review privacy**: automatic detection of emails, phone numbers, and payment card numbers in
  imported documents and filenames -- universal patterns, not tied to one jurisdiction -- plus
  whatever additional patterns the active template declares (e.g. UK postcodes, National
  Insurance numbers, driving licence numbers for `consumer-complaint`; a VIN for
  `provenance-trace`). Every finding gets an explicit keep-or-remove decision before export.
- **Redact non-destructively**: approved removals are flattened out of the exported PDF
  (the page is rasterised, not just visually covered); the original file in storage is never
  modified.
- **Export**: a PDF evidence pack, a JSON manifest with hashes and source metadata, a
  `.tracepack` bundle (both, zipped into one file), or a `.epack` file conforming to the open
  [Evidence Pack v1](https://github.com/locktivity/evidence-pack) container format, readable by
  any compatible tool, not just Tracepack. Two exported manifests can be diffed by evidence item
  id and content hash with `tracepack diff-manifest` (see
  [`packages/cli/README.md`](packages/cli/README.md)), to see exactly what changed in a pack
  between two points in time.
- **Import from other tools**: the `tracepack-evidence` v1 interchange contract lets an
  external tool hand Tracepack structured evidence (with its own hashes, provenance, and
  claims) without Tracepack needing to trust that tool's implementation. See
  [`packages/evidence-interchange/SPEC.md`](packages/evidence-interchange/SPEC.md) and
  [`packages/evidence-interchange/PRODUCER_GUIDE.md`](packages/evidence-interchange/PRODUCER_GUIDE.md)
  if you want to build one.
- **Embed a "Send to Tracepack" button**: any third-party site can hand evidence straight into a
  customer's own local pack with one click and no server -- see
  [`packages/evidence-interchange/EMBED_GUIDE.md`](packages/evidence-interchange/EMBED_GUIDE.md)
  and the worked example at
  [`examples/embed/gift-shop-refund-button/`](examples/embed/gift-shop-refund-button/).

## What Tracepack does not claim

Producer identity in the interchange contract is **self-asserted, not cryptographically
verified**; see `SPEC.md` §5 and §13 for exactly what a hash does and does not prove. Tracepack
does not currently support any form of multi-party signing, authenticated identity, or hosted
sync. See [`SECURITY.md`](SECURITY.md) for the full trust model.

## Repository layout

```
apps/
  workspace/    the web app (React + Vite) -- deployed at app.tracepack.org
  extension/    the browser extension (loads the workspace app + adds page capture)
  website/      marketing site -- deployed at tracepack.org
  developer/    developer landing page (CLI/SDK/format) -- deployed at dev.tracepack.org
packages/
  evidence-core/          domain model (projects, evidence items, categories) -- built to
                           publish standalone on npm, zero framework/runtime dependency
  evidence-sdk/           the tracepack-evidence v1 contract's portable half: types, schema
                           validation, RFC 8785 canonicalization -- built to publish standalone
                           on npm
  evidence-interchange/   tracepack-evidence v1 import into Tracepack itself (uses evidence-sdk
                           plus document-engine/storage, so this part stays Tracepack-internal)
  document-engine/        PDF text extraction, PII detection, redaction
  export-engine/          PDF pack, JSON manifest, .tracepack bundle builders
  storage/                IndexedDB persistence
  template-engine/        loads and validates template.yaml definitions -- built to publish
                           standalone on npm
  cli/                    @tracepack/cli -- validates a template.yaml or an evidence payload,
                           and diffs two exported manifest.json files, from the command line,
                           outside the browser
templates/
  consumer-complaint/, provenance-trace/, general/   the templates that ship today -- see
                                                      templates/CONTRIBUTING.md to add another
examples/
  producers/consumer-rights-helper/   a worked example of an independent tracepack-evidence
                                       producer, built with zero imports from Tracepack's own
                                       code: proof the interchange contract is genuinely
                                       implementable by someone who's never seen this repo
```

## Development

Requires [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm run dev
```

Open the local address Vite prints.

To build and load the browser extension:

```sh
pnpm --filter @tracepack/extension build
```

Load `apps/extension/dist` as an unpacked extension via `chrome://extensions` (or
`edge://extensions`) with Developer mode on.

Run everything across the whole workspace:

```sh
pnpm -r typecheck
pnpm -r test
```

See [`apps/extension/e2e/CHROME_EDGE_CHECKLIST.md`](apps/extension/e2e/CHROME_EDGE_CHECKLIST.md)
for what still needs manual verification on a real browser before a release; the automated
`e2e` script covers the detect-review-redact-export journey, not toolbar interaction.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Governance

See [`GOVERNANCE.md`](GOVERNANCE.md) for who maintains this project and how decisions get made.

## Security

See [`SECURITY.md`](SECURITY.md) for the trust model and how to report a vulnerability.

## Privacy

See [`PRIVACY.md`](PRIVACY.md) for who is responsible for what data Tracepack's websites and
support channels process, kept in sync with the same policy published at
[docs.tracepack.org](https://docs.tracepack.org). This is separate from `SECURITY.md`'s trust
model, which covers what the product itself does with evidence in your browser, not who
Spendmita Ltd is or what the company processes.

## Licence

Two licenses, split by what each part of the repository is for. The `tracepack-evidence`
format and SDK layer (`packages/evidence-core`, `evidence-sdk`, `template-engine`, `cli`, and
`examples/`) are Apache License 2.0, free for anyone to build on with no restriction. The
product itself (`apps/`, `templates/`, and the remaining `packages/`) is GNU Affero General
Public License v3.0, free to self host and modify, with the condition that a modified,
network hosted version has to share its source. A commercial license is available for anyone
who wants the AGPLv3 covered code without that condition. See
[`LICENSING.md`](LICENSING.md) for the exact map and
[`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md) for the commercial option.
