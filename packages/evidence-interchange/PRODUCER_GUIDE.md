# Building a Tracepack evidence producer

This is a practical, step-by-step guide for a developer who has never seen Tracepack's source
and wants to make their own tool hand structured evidence to Tracepack via `tracepack-evidence`
v1. If you want the full design rationale — *why* each rule exists, what alternatives were
considered and rejected — read [`SPEC.md`](./SPEC.md) instead. This document assumes you just
want to build something that works.

The definitive machine-readable contract is
[`tracepack-evidence.v1.json`](../evidence-sdk/schema/tracepack-evidence.v1.json). This guide
explains it in prose; the schema is what actually gets validated against.

A complete, working, independently-built example lives at
[`examples/producers/consumer-rights-helper/`](../../examples/producers/consumer-rights-helper/)
— a producer with **zero imports from Tracepack's own code**, built only from this guide, the
schema, and standard libraries. If anything below is ambiguous, read that package's
`src/producer.ts` for a worked answer.

**You don't have to hand-roll this.** Everything below — the schema types, `validateEvidencePayload`,
and RFC 8785 canonicalization/hashing — is also published as [`@tracepack/evidence-sdk`](../evidence-sdk/README.md),
a small package with no dependency on Tracepack's browser code. If you'd rather depend on tested
code than re-implement §3's hashing procedure yourself, skip to that package's README instead.
The rest of this guide still applies either way — it explains what the SDK is doing for you.

## 1. The payload shape

A payload is one JSON object with these top-level fields:

| Field | Required | Meaning |
|---|---|---|
| `schema_version` | yes | Always `1` for this version. |
| `source` | yes | Who produced this — see §4. |
| `capture_timestamp` | yes | ISO 8601, when *you* captured this evidence, not when Tracepack imports it. |
| `source_url` | no | An `http(s)://` URL this evidence relates to. |
| `evidence_type` | yes | Free text you choose, e.g. `"product_listing_review"`. Not a closed enum — Tracepack doesn't gatekeep what kinds of evidence exist. |
| `attachments` | yes (may be `[]`) | See §2. |
| `observations` | yes (may be `[]`) | See §5. |
| `metadata` | no | Your own open extension object. Capped at 64KB serialised; must not contain `__proto__`, `constructor`, or `prototype` keys at any depth. |
| `integrity` | yes | See §3. |

**Every optional field must be omitted when you have nothing to put there — never sent as
explicit `null`.** The validator rejects `null` for any optional field as a type mismatch. This
also affects hashing (§3): omitted and `null` are not interchangeable representations of "no
value," so getting this wrong breaks your hash before it breaks validation.

## 2. Attachments

```json
{
  "id": "receipt-1",
  "filename": "receipt.pdf",
  "mime_type": "application/pdf",
  "size": 4213,
  "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "encoding": "base64",
  "data": "<base64 text>"
}
```

- `mime_type` is one of exactly four values: `application/pdf`, `image/jpeg`, `image/png`,
  `image/webp`. Nothing else validates.
- `encoding` is always `"base64"` — the only transport v1 supports. No remote URLs, no
  multipart bundles.
- `size` is the **decoded** byte length. Tracepack decodes your base64 and rejects a mismatch.
- **`content_hash` is SHA-256 of the original binary file bytes, computed before base64
  encoding.** Never hash the base64 text itself — that's the single most common mistake a
  first implementation makes. The procedure:

  ```
  original binary bytes → SHA-256 → content_hash
  original binary bytes → base64 encode → attachments[].data
  ```

  On import, Tracepack base64-decodes your `data`, re-hashes the recovered bytes, and rejects
  the whole payload if that doesn't match your declared `content_hash`.

`attachments` may be an empty array. If it is, Tracepack synthesizes a deterministic
`text/plain` rendering of your `observations` to file as the evidence item — see §5's note on
what that means for the resulting hash. This is a Tracepack-side implementation detail; you
don't need to do anything differently as a producer either way.

## 3. Integrity — computing `payload_hash`

```json
"integrity": {
  "algorithm": "sha256",
  "canonicalization": "RFC8785",
  "payload_hash": "..."
}
```

Both `algorithm` and `canonicalization` are fixed constants (`"sha256"`, `"RFC8785"`) — not
choices. `payload_hash` is what you compute:

1. Take your full payload object.
2. From every entry in `attachments[]`, remove only the `data` key. Keep everything else
   (`id`, `filename`, `mime_type`, `size`, `content_hash`, `encoding`).
3. From `integrity`, remove only `payload_hash`. Keep `algorithm` and `canonicalization`.
4. Canonicalise that resulting object using **RFC 8785** (JSON Canonicalization Scheme) —
   the real IETF standard, unmodified. Use a real RFC 8785 library for your language; don't
   hand-roll one. (The example producer uses `json-canonicalize` — deliberately a *different*
   npm package from the one Tracepack's own implementation wraps, to prove genuine
   cross-implementation interoperability, not just "the same library agreeing with itself.")
5. UTF-8 encode the canonical string.
6. SHA-256 it. That hex digest is `payload_hash`.

This is field-level exclusion, not whole-object exclusion — every other field, including ones
that might look transport-related (`attachments[].size`, `attachments[].filename`), is part of
the hash. Getting this wrong is the most likely reason your payload will be rejected with an
"integrity hash does not match" error even though every individual field looks correct.

A few RFC 8785 specifics worth knowing if you're not already familiar with the standard:
object keys sort by UTF-16 code unit (matches `Array.prototype.sort()`'s default JS behaviour);
numbers serialise via the exact ECMA-262 shortest-round-trip algorithm; `-0` canonicalises as
`0`; empty arrays/objects are **not** omitted from the hash (`"observations": []` is part of
what gets hashed, not dropped). See `SPEC.md` §6.2 for the full rule set and a worked test
vector you can check your implementation against directly.

## 4. Producer identity — `source`

```json
"source": {
  "producer_id": "org.example.your-tool",
  "producer_name": "Your Tool",
  "producer_version": "1.0.0"
}
```

`producer_id` and `producer_name` are required; `producer_version` is optional. Reverse-DNS
style is recommended for `producer_id` but not enforced.

**This identity is self-asserted. Tracepack does not cryptographically verify who sent a
payload in v1.** Nothing stops another producer from claiming your `producer_id`. Design your
integration accordingly — don't build anything that assumes Tracepack has authenticated you.
Tracepack's own UI and exports are written to never imply otherwise (look for "self-asserted"
and "not cryptographically verified" language in exported manifests). A future schema version
may add real signature-based authentication; v1 deliberately does not have it.

## 5. Observations — what you're allowed to claim

```json
{
  "id": "obs-1",
  "kind": "warranty_period_active",
  "label": "Purchase within warranty window",
  "detail": "Longer free-text explanation of the claim.",
  "confidence": 0.9,
  "attachment_ref": "receipt-1",
  "data": { "your": "own extension object" }
}
```

- `id`, `kind`, `label`, `detail` are required. `kind` is free text you choose — not a closed
  enum.
- `confidence` is **your** confidence in your own claim, not anything Tracepack assigns.
- `attachment_ref`, if set, must match an `id` in this payload's `attachments[]` — it scopes
  the observation to that specific attachment. Omit it for an observation about the evidence
  as a whole.
- `data` is your own open extension object, subject to the same 64KB/unsafe-key limits as
  top-level `metadata`.

**Observations are claims you're making, not facts Tracepack verifies.** Tracepack renders
them clearly attributed to you — "Reported by *Your Tool*. Not independently verified by
Tracepack." — on export, and keeps them structurally separate from Tracepack's own PII/privacy
findings everywhere in the data model. They will never silently become "Tracepack found X."

## 6. What happens on import

Roughly, in order:
1. Schema validation (structure, types, required fields).
2. `schema_version` check — an unsupported version is rejected before anything else is even
   read.
3. Payload hash verification (§3) — rejects if it doesn't match.
4. Per-attachment hash verification (§2) — rejects if any attachment's bytes don't match its
   declared `content_hash`.
5. PDF attachments go through Tracepack's own PII scanner — the same one a manually-uploaded
   PDF goes through. This is independent of anything you declare; you can't opt out of it or
   assert your file has no PII.
6. Everything is filed into the target project and persisted atomically — either the whole
   import succeeds (every attachment, every derived evidence item, the updated project) or
   none of it does.

A rejection at any of steps 1–4 leaves the target project completely untouched — no partial
writes.

## 7. Errors

Validation failures come back as a list of issues, each with a `path` (where in your payload)
and a `message`. Common causes, roughly in the order you're likely to hit them building your
first producer:

| Symptom | Likely cause |
|---|---|
| Rejected immediately, one issue, path `schema_version` | Missing or unsupported `schema_version` |
| "integrity hash does not match" | §3's canonicalization/exclusion rules not followed exactly, or a field changed after you computed the hash |
| "content hash does not match" | `content_hash` computed over the base64 text instead of the original binary bytes, or the attachment bytes changed after hashing |
| "declared size ... but decoded to ... bytes" | `size` doesn't match the actual decoded byte length |
| Schema validation failure on an optional field | Sent explicit `null` instead of omitting the field |
| Schema validation failure on `mime_type` | Attachment type outside the four supported MIME types |
| "not part of this project's template" | The destination category (chosen by the *caller* importing your payload into a specific project, not by you) doesn't exist in that project's template |

## 8. Versioning and limits

- `schema_version` is currently always `1`. Tracepack rejects any value it doesn't explicitly
  support, before interpreting anything else — this is deliberate: a future `2` is a real
  breaking-change boundary, not an in-place mutation of what `1` means. See `SPEC.md`'s status
  banner for the freeze commitment.
- `metadata` and `observations[].data` are capped at 64KB serialised each, and must not contain
  `__proto__`, `constructor`, or `prototype` keys at any depth (checked recursively).
- There's no currently-enforced limit on attachment count or total payload size beyond what's
  practical to base64-encode and transmit — don't assume unlimited, but no specific number is
  contractually promised either way in v1.

## 9. A worked valid example

See [`tests/fixtures/generic-analysis-tool.json`](./tests/fixtures/generic-analysis-tool.json)
for a complete, schema-valid payload, and
[`examples/producers/consumer-rights-helper/src/producer.ts`](../../examples/producers/consumer-rights-helper/src/producer.ts)
for one built from scratch with working code — hashing, canonicalization, and all — plus a test
harness proving it's actually accepted by Tracepack's real import pipeline, not just
schema-valid in isolation.
