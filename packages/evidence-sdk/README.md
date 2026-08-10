# @tracepack/evidence-sdk

Portable TypeScript types, schema validation, and RFC 8785 canonicalization/hashing for the
`tracepack-evidence` v1 interchange contract -- the format an external tool uses to hand
Tracepack structured evidence without Tracepack needing to trust that tool's implementation.

This package has **no dependency on Tracepack's browser code** (no `document-engine`, no
`storage`, no `pdfjs-dist`, no IndexedDB). It only depends on `zod` and `canonicalize`, both
ordinary npm packages, and runs under any modern Node, a bundler, or the browser. If you're
building a producer and don't want to hand-roll the hashing procedure yourself, this is that
code, tested against the same fixtures Tracepack tests itself against.

For the full design rationale and payload walkthrough, read
[`../evidence-interchange/PRODUCER_GUIDE.md`](../evidence-interchange/PRODUCER_GUIDE.md) -- this
README is just the API surface.

## Install

```
npm install @tracepack/evidence-sdk
```

## What this does and does not do

- **Does:** validate a payload's shape against the frozen v1 schema, canonicalize a JSON value
  per RFC 8785, and compute the SHA-256 hashes the contract requires.
- **Does not:** send anything anywhere, read files, or talk to Tracepack. You still assemble the
  payload (read your own files, base64-encode attachments) and hand the finished JSON to
  whatever imports it into Tracepack.
- **Does not:** verify who you are. Producer identity in `source` is self-asserted in v1 -- see
  the design doc's §5.

## Usage

```ts
import {
  validateEvidencePayload,
  computePayloadHash,
  sha256Hex,
  type TracepackEvidencePayloadV1,
} from "@tracepack/evidence-sdk";

// 1. Hash each attachment's original binary bytes (before base64 encoding).
const contentHash = await sha256Hex(originalFileBytes);

// 2. Assemble the payload with everything except integrity.payload_hash.
const draft = {
  schema_version: 1 as const,
  source: { producer_id: "org.example.your-tool", producer_name: "Your Tool" },
  capture_timestamp: new Date().toISOString(),
  evidence_type: "product_listing_review",
  attachments: [
    {
      id: "receipt-1",
      filename: "receipt.pdf",
      mime_type: "application/pdf" as const,
      size: originalFileBytes.length,
      content_hash: contentHash,
      encoding: "base64" as const,
      data: base64Encode(originalFileBytes),
    },
  ],
  observations: [],
  integrity: { algorithm: "sha256" as const, canonicalization: "RFC8785" as const, payload_hash: "" },
};

// 3. Compute the payload's own integrity hash (excludes attachment bytes and payload_hash
//    itself -- see computePayloadHash's implementation for the exact field exclusions).
const payload: TracepackEvidencePayloadV1 = {
  ...draft,
  integrity: { ...draft.integrity, payload_hash: await computePayloadHash(draft) },
};

// 4. Validate before sending -- catches shape/type problems before Tracepack would reject them.
const result = validateEvidencePayload(payload);
if (!result.ok) {
  console.error(result.issues); // [{ path, message }, ...]
} else {
  // send `payload` (JSON) to whatever imports it into Tracepack
}
```

## The JSON Schema

The machine-readable schema this package validates against ships alongside it:

```ts
import schema from "@tracepack/evidence-sdk/schema/tracepack-evidence.v1.json" with { type: "json" };
```

Useful if your own toolchain validates with a JSON Schema library (Ajv, etc.) instead of this
package's `validateEvidencePayload`. **The schema file alone is not the complete contract** --
a handful of rules (duplicate ids, dangling references, real calendar-date validity, unsafe
`metadata` keys) are cross-field or semantic checks plain JSON Schema cannot express. See
`test-vectors/README.md`'s `json_schema_alone_sufficient` explanation for exactly which rules
that affects.

## Conformance test vectors

[`test-vectors/`](test-vectors/) is a language-agnostic set of pass/fail fixtures (attachment
content-hash, payload integrity-hash, and schema/validation vectors) for anyone implementing a
producer or consumer outside TypeScript. Reproduce every vector there before sending or
accepting a real payload; `tests/test-vectors.test.ts` keeps this package's own code honest
against the same files.

## Versioning

`schema_version: 1` in the wire format is frozen -- see the design doc's freeze statement. This
package's own npm version can move independently (bug fixes, additional exports); a `1.x` release
always validates against `schema_version: 1` the same way. A future `schema_version: 2` would
ship as a new major version of this package.

## License

Apache-2.0
