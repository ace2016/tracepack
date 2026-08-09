# Consumer Rights Helper — a clean-room tracepack-evidence producer

This is a worked example of an independent producer implementing
[`tracepack-evidence` v1](../../../packages/evidence-interchange/SPEC.md) — the interchange
contract that lets any external tool hand structured evidence to Tracepack.

## Why this exists

Publishing a specification is not the same as proving it's implementable. This package proves
it, mechanically:

- **`src/producer.ts`** imports nothing from `@tracepack/*`. It builds a complete payload —
  attachment hashing, RFC 8785 canonicalization, payload hashing, observations, provenance —
  using only `packages/evidence-interchange/SPEC.md`, the public JSON Schema, and independent
  libraries (`json-canonicalize`, not the `canonicalize` package Tracepack's own code uses;
  `pdf-lib`; Node's built-in `crypto`).
- **`tests/clean-room-integration.test.ts`** is the only file that imports `@tracepack/*`. It
  feeds the producer's output into Tracepack's real `importEvidencePayload()`, lets it flow
  through the real storage layer and the real `export-engine` PDF/manifest builders, and
  asserts the whole pipeline behaves correctly end to end — accepted, provenance preserved,
  the observation attributed to the producer (never presented as a Tracepack finding), the
  attachment routed through Tracepack's own PII scanner, genuinely persisted, and correctly
  rendered in both the exported PDF and the JSON manifest.

If this package's two files ever diverge from what the real SPEC/schema actually require, this
test starts failing — that's the point.

## Running it

```sh
pnpm install
pnpm --filter consumer-rights-helper-example-producer test
pnpm --filter consumer-rights-helper-example-producer typecheck
```

## What's mocked, and why

Exactly one thing: `@tracepack/document-engine`'s `inspectPdf()`. It's written for its real
runtime home — a browser tab with a bundler-resolved pdf.js worker — not plain Node, which is
also why `packages/evidence-interchange/tests/pdf-pii-scan.test.ts` mocks it. The test asserts
`inspectPdf` was actually called, with the producer's real attachment bytes, which proves the
import pipeline *routes* the attachment through Tracepack's own scanner rather than skipping
it. It does not re-test pdf.js text extraction itself — that's already covered by
`document-engine`'s own test suite.

Nothing else is mocked. Storage runs against a real (fake) IndexedDB via `fake-indexeddb`, not
a stub — evidence is genuinely written and read back before being exported.
