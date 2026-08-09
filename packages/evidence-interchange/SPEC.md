# Tracepack Evidence Interchange — v1 design and contract

This document exists so a developer who has never seen the Tracepack source can build a
conforming producer, and so anyone reviewing this package can see the reasoning behind it,
not just the code. It is written before implementation and kept in sync with it.

**Status: FROZEN as of this revision.** `schema_version: 1` is a compatibility contract from
here forward. A conforming payload built against this document today must still be accepted by
Tracepack tomorrow; any breaking change to what this document requires is a new schema version
(`2`), never a silent edit to what `1` means. This is not a promise resting on the
implementation alone — it's been verified the way §25's acceptance test demands: an independent
producer (`examples/producers/consumer-rights-helper/`), built with zero imports from
Tracepack's own source — only this document, the public JSON Schema, and standard libraries —
constructs a payload, computes its own hashes, and is accepted end to end by Tracepack's real
`importEvidencePayload()`, storage, and export pipeline. See that package's README for exactly
what it proves and the one thing it deliberately mocks (and why). §16 has the full file-by-file
implementation record; §17 has the freeze checklist.

## 1. What this is for

Today, evidence only enters Tracepack two ways: a person uploads a PDF/image file, or the
browser extension captures a webpage screenshot. Both are manual, single-file, and produce
no more than what Tracepack itself can extract (PDF text, a screenshot).

This package defines a portable JSON format, `tracepack-evidence`, that lets **any external
tool** hand Tracepack a piece of evidence plus structured claims about it — without that tool
needing to know anything about Tracepack's internals, and without Tracepack needing to trust
those claims as its own. A product-review analyzer, a document-authenticity checker, a
compliance screening tool, or a future Spendmita integration can all speak this one format.
Spendmita is one possible producer of it, not the reason it exists — nothing in this schema
or code is Spendmita-specific.

## 2. The mapping (read this before reading any code)

```
tracepack-evidence payload (JSON, from an external producer)
        │
        │  1 payload, N attachments  →  N EvidenceItem (one per attachment)
        │  1 payload, 0 attachments  →  1 EvidenceItem (synthesized "note", see §6.3)
        ▼
EvidenceItem[]  (packages/evidence-core — TWO NEW OPTIONAL FIELDS, see §4)
        │
        │  each attachment's decoded bytes  →  packages/storage.saveEvidenceFile(item.id, blob)
        │  each EvidenceItem                →  packages/evidence-core.addEvidence(project, item)
        │  each PDF attachment              →  document-engine.inspectPdf(blob), populating
        │                                       pageCount/extractedText/privacyFindings exactly
        │                                       as a manually-uploaded PDF would (see §12) —
        │                                       an external producer is not trusted to have
        │                                       checked its own attachment for PII
        ▼
TracepackProject  (unchanged shape, just more evidence in project.evidence[])
        │
        │  existing template category matching (unchanged — importer must supply a
        │  category_id the caller resolves against project.template.categories, exactly
        │  like every other import path in this app already does; see §9 on why the
        │  payload itself carries no category information — that was removed, §14 item 2)
        ▼
export-engine.buildEvidencePack / buildManifest
        │
        │  ADDITIVE rendering: if item.observations is present, render them in a clearly
        │  attributed block ("Reported by <producer>. Not independently verified by
        │  Tracepack.") — never merged into Tracepack's own privacyFindings[], never
        │  presented as a Tracepack finding, never worded as a verified fact (§5)
        ▼
Exported PDF / JSON manifest
```

**Nothing about `TracepackProject`, `packages/storage`'s IndexedDB schema, or the
one-item-one-blob storage model changes.** The interchange package is a new front door onto
the existing house, not a new house next to it.

## 3. Why one envelope maps to N `EvidenceItem`s, not one

`EvidenceItem` is, today, fundamentally a *one file* model: one `originalFileName`, one
`mimeType`, one `size`, one `contentHash`, one blob keyed by `item.id` in
`packages/storage`. Every consumer assumes this — `export-engine`'s per-item render loop
does `files.get(item.id)` expecting exactly one blob, `EvidenceCard` in the workspace renders
exactly one preview.

An interchange payload can legitimately carry more than one attachment (e.g. "here is a
product listing screenshot *and* the underlying HTML source"). Two ways to reconcile that
with the model above:

- **(a)** Evolve `packages/storage` to support many blobs per `EvidenceItem`. Touches the
  IndexedDB schema, `export-engine`'s render loop, and the workspace UI's preview logic.
- **(b)** Map each attachment to its own `EvidenceItem`, all sharing the same `provenance`
  and `observations`.

**(b) was chosen.** It requires zero changes to `packages/storage`, zero changes to how
`export-engine` finds an item's blob, and zero changes to the workspace UI. It is the
"extend, don't introduce a parallel model" option. The cost is that a multi-attachment
payload becomes multiple sibling evidence items in the project rather than one item with
several files — acceptable, since Tracepack's whole evidence model is already "many small
items," not "one item, many files."

## 4. The trust boundary (design question 1)

An `observation` is a claim a producer makes about evidence. Tracepack did not independently
verify it. This distinction has to survive import, project storage, and export, or it's
meaningless.

**Structural answer:** `EvidenceItem` gains two new *optional* fields in `evidence-core`:

```ts
export interface EvidenceProvenance {
  producerId: string;        // stable machine id, producer-chosen, e.g. "com.example.review-analyzer"
  producerName: string;      // human-readable, shown in exports, e.g. "Example Review Analyzer"
  producerVersion?: string;
  schemaVersion: 1;          // the tracepack-evidence schema_version this item was imported from
  capturedAt: string;        // producer's own capture_timestamp (ISO 8601), not import time
  sourceUrl?: string;
}

export interface ExternalObservation {
  id: string;
  kind: string;               // producer-defined, e.g. "suspicious_review_clustering"
  label: string;               // short human-readable label
  detail: string;               // human-readable explanation
  confidence?: number;         // 0–1, the PRODUCER's own confidence, not Tracepack's
  data?: Record<string, unknown>; // producer-defined structured payload, see §8 for limits
}

// EvidenceItem gains:
provenance?: EvidenceProvenance;
observations?: ExternalObservation[];
```

These are **new, separate fields**, not a repurposing of `privacyFindings` (which stays
exactly what it is today: Tracepack's own regex-based PII detector output). A finding never
silently becomes an observation and vice versa. `observations` are only ever populated by
the interchange importer; nothing in the app's own PDF-import or capture path touches them.

**Why provenance lives on the item, not per-observation:** a v1 envelope has exactly one
producer for all its attachments and observations (see §8 for the schema). Every observation
under an item is therefore unambiguously traceable via that item's single `provenance`
field, without needing a redundant copy on every observation. A future version that lets one
envelope aggregate claims from multiple upstream producers would need per-observation
provenance — that's an explicit, called-out v2 consideration (§15), not a v1 gap.

**Why this lives in `evidence-core`, not `evidence-interchange`:** the task said this package
should "own the interchange contract rather than placing third-party transport concerns
inside evidence-core." The wire format, validation, hashing, and version handling *are* the
transport concern, and all of that lives in `evidence-interchange`. Whether `EvidenceItem`
*can represent* "this came from an external producer with claims attached" is a question
about Tracepack's own domain model, which every consumer of `evidence-core` (storage,
export-engine, the workspace UI) needs to agree on regardless of which transport produced the
data. Two small optional fields, additive, backward compatible — every existing
`EvidenceItem` in the wild is still valid with both fields simply absent.

**Enforcement at export:** `export-engine` gets one additive branch (§10) — an item with
`observations` gets a clearly labelled block, "Reported by *<producer>*. Not independently
verified by Tracepack.", never "Tracepack found…". This is checked by a test that
fixture-derives an item from a review-analysis tool and asserts the producer's name — not the
word "Tracepack" — is the one attributed to the observation text in the rendered PDF, and that
the rendered text does not match `/Tracepack (found|detected|determined)/i`.

## 5. Producer identity and authentication (v1: self-asserted, not verified)

`source.producer_id`, `source.producer_name`, and `source.producer_version` are
**self-asserted** by whatever sent the payload. This section exists because it is the single
easiest thing about this format to accidentally overstate, and overstating it would be a real
trust failure, not a cosmetic one.

**What v1 does *not* do:**

- Nothing in this format, and nothing in `importEvidencePayload`, cryptographically verifies
  that the named producer actually created the payload. A payload with
  `producer_id: "com.example.trusted-tool"` is accepted exactly as written — anyone able to
  construct a payload can put any string in `source`, compute a perfectly valid
  `integrity.payload_hash` over their own content (§6.2), and it will pass import cleanly.
  There is no allow-list, no registration, no key.
- `integrity.payload_hash` proves the structured claims are exactly what was hashed — it does
  **not** prove who computed that hash. Anyone able to construct or modify a payload can also
  recompute a valid hash for their version of it. It is a **consistency check**, not a
  signature. See §13 for the full distinction between integrity and authentication.
- Each `attachments[].content_hash` (§6.1) establishes only that the stored bytes match the
  bytes that specific hash was computed from — again integrity, not authorship, and
  certainly not authenticity of whatever the attachment depicts.
- Neither mechanism, nor anything else in this format, establishes that any `observations[]`
  entry is *true*. A producer's stated `confidence` is the producer's own number, not a
  Tracepack-assigned score, and is never treated as one.

**What this means for the UI and export (binding requirement, not a suggestion):**
Tracepack's UI and exported PDF/JSON must describe a producer only as the **declared** or
**reported** producer — language like "Reported by *Example Review Analyzer*. Not
independently verified by Tracepack." (the exact wording `export-engine` already uses). They
must never use language that implies a verified or authenticated identity — no "verified
source," no trust badge or checkmark, no phrasing that reads as Tracepack having confirmed who
sent this.

**What v1 deliberately does not add:** cryptographic producer authentication — digital
signatures, public-key verification, a trust/allow-list of known producer keys — is out of
scope for v1 entirely. No PKI, no key material, no signature field exists anywhere in this
schema. It is the leading candidate for a v2 addition (§15), most likely as a signature layer
that wraps this same v1 envelope — so today's unsigned v1 payloads remain valid inputs to that
future layer — rather than a breaking schema change. Building that properly (key distribution,
revocation, what "verified" should even mean for a local-first tool with no central authority)
is its own design pass and is not undertaken here.

## 6. Hash semantics (design question 2)

The candidate field list had one `content_hash`. That's exactly the ambiguity the task asked
to resolve — one hash cannot mean "these bytes are what the producer sent" *and*
"this whole structured claim wasn't tampered with" at the same time, because a payload can be
correct in its bytes and still lie in its content, or vice versa (a proxy that legitimately
re-encodes an attachment changes its bytes without changing what happened).

Two separate, named concepts:

### 6.1 Attachment content hash — `attachments[].content_hash`

SHA-256 (lowercase hex, 64 chars) of the attachment's **original binary file bytes** — the
exact same bytes a person would get by saving the file to disk, before any base64 encoding.
This is not a new concept — it is *exactly* what `EvidenceItem.contentHash` already means
today (`document-engine.sha256()` hashes the raw `Blob`).

**The full, unambiguous procedure, with no step left implicit:**

1. The producer starts with the original binary file bytes (e.g. the PDF or image file as it
   exists on disk).
2. The producer computes SHA-256 over exactly those binary bytes. This is
   `attachments[].content_hash`.
3. The producer base64-encodes those *same* bytes — not some other representation — into
   `attachments[].data`, for JSON transport.
4. The importer base64-decodes `attachments[].data` back into binary bytes.
5. The importer computes SHA-256 over the *decoded* binary bytes.
6. Import succeeds only if that value equals the declared `attachments[].content_hash`
   character-for-character (lowercase hex). Any mismatch rejects the whole import (§10).

**The base64 text is never the hashing target, in either direction.** Hashing the base64
*string* (its UTF-8/ASCII text bytes) instead of the *decoded binary* it represents is the
single most likely mistake a first-time implementer makes with this field, and it produces a
completely different, silently-wrong hash with no error until Tracepack rejects the import —
so this document says it three times: hash the binary, encode the binary, decode back to the
same binary, hash that. Never hash the base64 characters themselves.

**Test vector** (verify your implementation against this before writing anything else):

```
Original content (UTF-8 text, used here only because it's easy to reproduce by hand —
attachments in practice are binary PDF/image bytes, and this hash procedure is byte-level,
not text-level; the same steps apply regardless of what the bytes represent):

  "Tracepack interchange test attachment."

Byte length:        38
Base64 (attachments[].data):
  VHJhY2VwYWNrIGludGVyY2hhbmdlIHRlc3QgYXR0YWNobWVudC4=

SHA-256 hex of the ORIGINAL BINARY BYTES (attachments[].content_hash):
  a07b37177fb90cbf3a9c37f003425ad458e71f209c87b2c8f0b3512dc90c2694
```

If your implementation base64-decodes the string above and gets a SHA-256 other than
`a07b37177fb90cbf3a9c37f003425ad458e71f209c87b2c8f0b3512dc90c2694`, it has a bug before it has
sent a single real payload. This vector, plus the payload-level vector in §6.2, should ship as
machine-checked fixtures in `tests/fixtures/` when this package is implemented (§16).

**What it proves:** the bytes Tracepack stored are the exact bytes the producer hashed and
sent. **What it does not prove:** that the attachment is authentic, unaltered from whatever
real-world thing it depicts, or that any observation about it is accurate. A doctored
screenshot hashes just as cleanly as a real one. See §5 and §13 for the broader point this is
one instance of: hashes prove integrity, never truth or authorship.

### 6.2 Payload integrity hash — `integrity.payload_hash`

SHA-256 of a **canonicalised JSON serialisation** of the envelope's semantic content —
excluding embedded attachment bytes (those are covered separately by §6.1) and excluding
`integrity.payload_hash` itself (to avoid hashing including itself). This lets an importer
detect whether the *structured claims* (observations, metadata, timestamps) were altered in
transit, independent of whether the attachment bytes are intact.

**Precisely what "excluding" means, because this is the one spot a first-time implementer is
most likely to get wrong (an early independent implementation of this section did):** this is
field-level exclusion, not whole-object exclusion. Take the full payload object, including its
`attachments` array and its `integrity` object, and:

- for every entry in `attachments[]`, remove only the `data` key — keep `id`, `filename`,
  `mime_type`, `size`, `content_hash`, `encoding`;
- from `integrity`, remove only `payload_hash` — keep `algorithm` and `canonicalization` in
  what gets hashed.

Canonicalise and hash *that* object — not the payload with `attachments` or `integrity`
dropped wholesale, and not the payload as originally received.

**Canonicalisation: RFC 8785 (JSON Canonicalization Scheme), unmodified — not a subset.**

An earlier draft of this document specified a hand-rolled "subset" of RFC 8785, reasoned to be
sufficient because the schema's own defined fields are all plain finite numbers and simple
strings. That reasoning doesn't hold once `metadata` and `observations[].data` are taken into
account: both are open, producer-defined extension points (§8) that can legitimately contain
arbitrary nested numbers, strings, and Unicode content — exactly the cases where a hand-rolled
subset and the real standard can diverge. Maintaining a bespoke near-standard, with no
existing library in any other language and no independently-published test vectors beyond
whatever this repository ships, is strictly *more* interoperability risk than depending on a
real IETF standard that already has conformant, tested libraries in Python, Go, Rust, and Java,
checked against RFC 8785's own official test vectors. **v1 uses RFC 8785 directly.** The
`integrity.canonicalization` field is the literal string `"RFC8785"`.

Concretely, this means, on top of the field-exclusion rule above:

1. **Key ordering:** object keys are sorted by UTF-16 code unit value — this is what
   `Array.prototype.sort()` does by default in JavaScript, and it is what RFC 8785 specifies.
   For every key this schema itself defines (all ASCII), this is identical to sorting by
   Unicode code point, so it "just works" without a second thought. **It is not identical for
   producer-defined keys inside `metadata` or `observations[].data` that use characters
   outside the Basic Multilingual Plane** (rare, but possible — e.g. some emoji as object
   keys): UTF-16 code-unit order and code-point order can disagree there, because a
   supplementary-plane character's leading surrogate (`0xD800`–`0xDBFF`) can sort before a BMP
   character whose actual code point is smaller. Confirmed directly: sorting the two single-
   character strings `"𐀀"` (U+10000) and `""` (U+E000, a BMP character with a *smaller*
   code point) with plain UTF-16 code-unit comparison puts `"𐀀"` first, even though its code
   point is larger. If cross-language hash reproducibility matters for a given payload,
   producers should keep object keys inside `metadata`/`observations[].data` to the Basic
   Multilingual Plane. This is a known, accepted RFC 8785 property, not a Tracepack deviation.
2. **String escaping:** exactly RFC 8785's string serialisation, which matches
   ECMA-262 `JSON.stringify` string escaping — quote and backslash are escaped, control
   characters `U+0000`–`U+001F` are escaped, forward slash is *not* escaped, and other
   Unicode characters are emitted literally as UTF-8, not `\u`-escaped. `U+2028`/`U+2029`
   (line/paragraph separator) are left unescaped, same as `JSON.stringify` — they are valid
   JSON string content even though they're awkward in some non-JSON contexts.
3. **Number representation:** RFC 8785 requires the exact ECMA-262 `Number::toString`
   (shortest round-trippable decimal) algorithm for every JSON number, specifically so that
   independent implementations converge on identical digit sequences. This schema's own
   defined numeric fields (`attachments[].size`, an integer; `observations[].confidence`, a
   float in `[0, 1]`) are unlikely to ever hit a precision edge case, but `metadata` and
   `observations[].data` are open — **producers must not put numbers requiring more precision
   than an IEEE-754 double can exactly represent, or integers outside `±(2^53 − 1)`, into
   `metadata`/`observations[].data` if cross-language hash reproducibility matters; encode
   such values as strings instead.** This is a real constraint, not boilerplate — it is
   exactly the category of bug a hand-rolled canonicalizer without RFC 8785's precise number
   rule would silently get wrong across languages.
4. **`-0`:** canonicalises identically to `0` (confirmed: `JSON.stringify(-0)` produces
   `"0"`, and RFC 8785 requires the same). A producer that happens to compute `-0` for some
   field does not need to worry about which sign survives — both hash identically to `0`.
5. **Unicode in string values:** emitted as literal UTF-8 characters, not escaped, except for
   the control characters and the two structural characters noted in point 2. The final
   canonical string is then encoded to bytes as **UTF-8** before hashing — always UTF-8,
   regardless of what encoding the original JSON was transmitted in.
6. **Omission vs. explicit `null`:** every optional field in this schema (`source_url`,
   `producer_version`, `metadata`, `observations[].confidence`, `observations[].attachment_ref`,
   `observations[].data`) must be **omitted** when not provided, never sent as `null`. This
   isn't a canonicalisation nicety — the reference validator rejects an explicit `null` for
   any of these fields as a type mismatch (they're typed as optional-string/number/object, not
   nullable), so a payload using `null` fails validation before canonicalisation is ever
   reached. Omitted and explicit-`null` are not interchangeable in this format, and only
   omission is valid.
7. **Recursively excluded fields:** exactly the two named at the top of this section —
   `attachments[].data` and `integrity.payload_hash` — and nothing else. Every other field,
   including ones that look large or transport-related (`attachments[].size`,
   `attachments[].filename`), is part of the hash.
8. **Empty arrays and objects are not omitted.** `observations: []` (a payload with no
   observations) canonicalises as `"observations":[]` and is part of the hash, not dropped.
   Likewise, a producer explicitly sending `metadata: {}` canonicalises differently from
   omitting `metadata` entirely — the field being *present but empty* versus *absent* are
   different payloads with different hashes. This is expected, not a bug.
9. **Attachment and observation order is part of the hash.** Arrays keep their given order —
   this is both an RFC 8785 requirement and semantically meaningful here (order can carry
   information, e.g. capture order). A producer must send `attachments[]`/`observations[]` in
   the same order it computed the hash with; reordering them after hashing breaks
   verification, by design.

**Test vector** (a complete minimal payload; every implementation should reproduce this exact
canonical string and hash):

```
Canonical form of the hashable object (attachments[].data removed, integrity reduced to
{algorithm, canonicalization}, keys sorted, no whitespace) for a payload with
schema_version: 1, source: {producer_id: "com.example.minimal-producer",
producer_name: "Minimal Test Producer"}, capture_timestamp: "2026-01-01T00:00:00Z",
evidence_type: "test_fixture", one attachment (id "a1", filename "test.txt",
mime_type "application/pdf", the same 38-byte attachment from §6.1's test vector),
and observations: []:

{"attachments":[{"content_hash":"a07b37177fb90cbf3a9c37f003425ad458e71f209c87b2c8f0b3512dc90c2694","encoding":"base64","filename":"test.txt","id":"a1","mime_type":"application/pdf","size":38}],"capture_timestamp":"2026-01-01T00:00:00Z","evidence_type":"test_fixture","integrity":{"algorithm":"sha256","canonicalization":"RFC8785"},"observations":[],"schema_version":1,"source":{"producer_id":"com.example.minimal-producer","producer_name":"Minimal Test Producer"}}

SHA-256 hex of that string, encoded as UTF-8 (this is integrity.payload_hash):
  916f46f76f4f07438fcca91f9c3371cf02ed3cca66f9e8062c24bf415f4a8573
```

This example deliberately uses only ASCII keys/strings and a safe integer, so it does not
exercise RFC 8785's more exotic number/Unicode rules (points 1 and 3 above) — it verifies the
field-exclusion and key-sorting mechanics that every implementation needs to get right first.
Additional vectors covering non-ASCII metadata keys and high-precision numbers should be added
to `tests/fixtures/` alongside this one when the package is implemented (§16), specifically
because those are the cases most likely to diverge between languages.

**What it proves:** the JSON structure wasn't corrupted or altered relative to what the
producer hashed. **What it does not prove:** that the claims inside are true, or that the
named producer is who actually computed the hash — see §13 and §5.

### 6.3 Attachment-less payloads

A payload with zero attachments (a producer supplying only structured claims — e.g. "we
checked and this project has no proof-of-purchase evidence available anywhere") is valid.

It maps to **one** `EvidenceItem` with `sourceType: "note"`, reusing exactly the same pattern
already shipped for the workspace's manual "Add a note" feature: a synthesized `text/plain`
blob stands in for the file, since `EvidenceItem` requires `size`/`mimeType`/`contentHash` to
be present, and `packages/storage` has no concept of an evidence item without a blob. No new
`SourceType` is introduced — `"note"` already exists, and every consumer of it (storage,
`export-engine`'s note-rendering branch, the workspace UI's note preview) already handles it
correctly with zero special-casing needed for this to work.

**This synthesized text is an implementation artifact, not evidential content in its own
right.** It exists solely to satisfy the current one-item-one-blob model's requirement that
every `EvidenceItem` have *some* backing blob; it is not a document the producer supplied, and
it is not a Tracepack-authored finding. Two consequences, both binding:

- The rendered text must open by identifying itself as a rendering of the producer's claims —
  not as an original source document and not as something Tracepack determined. (The current
  rendering starts with the producer's `evidence_type`, then `"Source: <producer_name> …"`,
  then each observation's label/detail — this already reads as "here is what a producer
  reported," not as free-standing fact, but implementers should preserve that framing rather
  than simplifying it away.)
- `contentHash` on the resulting `EvidenceItem` hashes exactly the bytes of *that* synthesized
  blob — the deterministic rendering actually stored — not some hash of the original
  observations JSON. Recomputing the rendering from the same observations must reproduce the
  same blob bytes and therefore the same hash; the rendering function must be deterministic
  (no timestamps, random ids, or non-deterministic ordering inside it).

## 7. Attachment transport (design question 3)

**v1 supports exactly one transport: inline base64-embedded bytes.** No remote references, no
fetch-on-import, no multipart bundles.

```ts
{
  id: string;
  filename: string;
  mime_type: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  size: number;          // decoded byte length, validated against actual decoded size
  content_hash: string;  // sha256 hex of the original binary bytes, see §6.1
  encoding: "base64";
  data: string;          // base64 encoding of those same binary bytes
}
```

This is a deliberate, narrow v1 scope, not an oversight:

- **No remote URI references.** The task was explicit: "do not introduce remote fetching
  implicitly." Supporting `attachments[].uri` would mean Tracepack — a local-first tool that
  otherwise never makes outbound requests on its own — reaching out to an arbitrary URL
  supplied by untrusted JSON. That's a real trust/security surface (SSRF-shaped risk, unclear
  timeout/failure/retry semantics, unclear caching, unclear what happens if the remote content
  changes after the hash was computed) that deserves its own deliberate design pass, not a
  field bolted on because it seemed convenient. If a future version adds it, it must come with:
  an explicit user confirmation before any fetch, an explicit allow-list or origin check, and
  explicit, tested failure behaviour for timeout/4xx/5xx/content-type-mismatch. None of that
  exists today, so the field doesn't exist today either.
- **No multipart/zip bundles.** A "bundle" (a zip of one JSON envelope plus sibling attachment
  files, instead of base64 inline) is a reasonable future layer, but it's a *transport*
  detail on top of the same v1 envelope schema, not a schema change. It can be added later
  without touching `schema_version` (§15).
- **Allowed MIME types match exactly what `document-engine.inspectFile` already accepts**
  today (PDF, JPEG, PNG, WebP) — the same four types Tracepack can already preview, embed in
  an export, and render. Anything else is rejected at validation, not silently accepted and
  mishandled later (§10).

**Attachment-to-item mapping:** decided in §3 — one `EvidenceItem` per attachment. An
`observations` entry may optionally carry `attachment_ref` (matching an `attachments[].id`)
to say "this claim is about that specific file." If `attachment_ref` is omitted, the
observation is about the evidence as a whole and is attached to every derived `EvidenceItem`.

## 8. The v1 payload shape

```ts
interface TracepackEvidencePayload {
  schema_version: 1;
  source: {
    producer_id: string;       // e.g. "com.example.review-analyzer" — reverse-DNS-style, producer-chosen
    producer_name: string;
    producer_version?: string;
  };
  capture_timestamp: string;   // ISO 8601, when the PRODUCER captured/generated this, not import time
  source_url?: string;         // absolute http(s) URL, if applicable
  evidence_type: string;       // producer-defined free text classification, e.g. "product_listing_review"
  attachments: AttachmentV1[]; // see §7, may be empty (see §6.3)
  observations: ObservationV1[]; // may be empty
  metadata?: Record<string, unknown>; // producer-defined, see §10 for size/safety limits
  integrity: {
    algorithm: "sha256";
    canonicalization: "RFC8785"; // see §6.2
    payload_hash: string;        // see §6.2
  };
}
```

There is no category field in the payload. There was one (`category_hint`) in an earlier
draft of this schema; it was removed. See §14 (Decision Log, item 2) for the full reasoning —
in short: the field was never actually read anywhere in the reference importer (category
resolution has always required the *caller* to supply an explicit `categoryId`, exactly like
every other import path in this app), so it provided zero real interoperability benefit while
leaking a Tracepack-specific concept (template category ids, which don't exist in any other
consumer of this format) into an otherwise vendor-neutral schema. Nothing is lost by its
absence: a Tracepack-aware caller can already derive a reasonable category suggestion from
`evidence_type` and `source_url` using the same kind of heuristic the extension's own capture
importer (`apps/workspace/src/captures.ts`) already uses for webpage captures — that mapping
belongs entirely on Tracepack's side of the boundary, not encoded into the portable format.

## 9. `schema_version` and unsupported-version behaviour

`schema_version` is a required top-level field from v1 onward, exactly matching the discipline
`TracepackProject.schemaVersion: 1` already has. The importer's very first check, before
looking at anything else in the payload, is: is this `schema_version` one this build of the
importer understands? If not, the import is rejected immediately with an error naming the
unsupported version and the versions this build supports — the payload is never partially
interpreted. `evidence-interchange` exports `SUPPORTED_SCHEMA_VERSIONS` so the check itself
is a single source of truth, not duplicated logic.

## 10. Validation and failure behaviour

All validation and hash verification happens **before** any project-metadata mutation is
constructed and before any blob write is issued — a failure at any of those checks means
**zero** storage calls happen at all, and the in-memory project object the caller already has
is never touched. That part of the guarantee is genuinely all-or-nothing today, verified by a
test asserting the original `project` object is unchanged after a rejected import.

**What is not (yet) fully atomic: persisting a successful import.** A successful import
currently writes each attachment's blob with a separate `packages/storage.saveEvidenceFile`
call per attachment, and the caller separately persists the updated project afterward via
`saveProject` — this is the same convention every other import path in this app already
uses (`apps/workspace/src/App.tsx`'s file/note import, `apps/workspace/src/captures.ts`), not
something this package invented. Concretely, that means:

- If IndexedDB fails partway through saving multiple attachment blobs (quota exceeded on the
  second of three, the tab closing mid-import), earlier blobs in that call may remain saved
  but unreferenced by any project, since the in-memory project — which the caller has not yet
  persisted — is never partially saved by the importer itself.
- That is an **orphaned-blob storage leak in a rare failure case, not a corrupted or
  partially-visible project.** No `EvidenceItem` ever appears in a project's `evidence[]`
  without also having a real blob behind it, because `addEvidence` is a pure in-memory
  function and the project is only ever persisted as one complete document via a single
  `saveProject` call — there is no intermediate state where the project object itself is
  half-written.
- The previous revision of this document described the storage write as fully all-or-nothing
  without this caveat. That was inaccurate, caught during this review. `packages/storage`'s
  `deleteProject` already proves genuine cross-store atomicity is possible with the `idb`
  library in use here (`db.transaction(["projects", "files"], "readwrite")`, writing to both
  stores under one transaction) — nothing about IndexedDB or `idb` prevents the same pattern
  for import. **The smallest correct fix, deferred to implementation (§16), is a narrowly
  scoped addition to `packages/storage`** — a function in the same shape as `deleteProject`
  that writes the project document and every attachment blob inside one
  `db.transaction(["projects", "files"], "readwrite")` — used specifically by this package's
  import path. This does not require redesigning `packages/storage`'s schema or touching the
  existing single-file save paths other import flows already rely on. Until that function
  exists, this document's honest claim is: *validation is atomic; a successful import's
  storage writes are ordered but not wrapped in one transaction, with a narrow and explicitly
  documented orphaned-blob failure mode that never produces a corrupted or partially-visible
  project.* Tests for the implemented version must simulate a failure during persistence
  itself (e.g. the second of three `saveEvidenceFile` calls rejecting) — not only validation
  failures — and confirm the project remains exactly as it was before the import began.

| Condition | Behaviour |
|---|---|
| Unsupported `schema_version` | Reject immediately, first check, before any other validation |
| Malformed payload (fails schema shape) | Reject with aggregated, field-path-tagged errors |
| Malformed hash (not 64 lowercase hex chars) | Reject |
| Attachment hash mismatch (declared vs. actual SHA-256 of decoded bytes, §6.1) | Reject the whole import |
| Missing attachment content (`data` absent/empty when an attachment entry exists) | Reject |
| Duplicate `attachments[].id` or `observations[].id` within one payload | Reject |
| Invalid `capture_timestamp` (not parseable ISO 8601) | Reject |
| Invalid `source_url` / `attachment.attachment_ref` dangling reference | Reject |
| Unsupported `mime_type` or `encoding` | Reject |
| An optional field sent as explicit `null` instead of omitted (§6.2 point 6) | Reject (type mismatch) |
| Unknown top-level fields | Reject (envelope schema is strict) — `metadata` and `observations[].data` are the sanctioned open extension points, everything else is a closed, exact shape |
| `metadata` / `observations[].data` too large (> 64 KB serialised) or containing `__proto__`/`constructor`/`prototype` keys | Reject |
| Failure during persistence itself (blob write fails after validation passed) | See atomicity discussion above — the in-memory project is never left partially updated; a saved-but-unreferenced blob is the documented narrow failure mode until the transactional storage function in §16 exists |

**The JSON Schema file alone does not enforce every row in this table.** Duplicate ids, dangling
`attachment_ref`s, real calendar-date validity, and the `metadata` unsafe-key check are
cross-field or semantic rules plain JSON Schema vocabulary cannot express -- they are enforced by
`validateEvidencePayload`'s code, not by `schema/tracepack-evidence.v1.json` alone. A consumer
that validates only against the schema file will incorrectly accept payloads violating those
four rows. `packages/evidence-sdk/test-vectors/validation/` has a machine-checkable vector for
every row above, tagged with `json_schema_alone_sufficient` so an implementer in any language
knows exactly which rules need code beyond schema validation, not just documentation to read.

## 11. Building a conforming producer, end to end

1. Collect your evidence and whatever claims you want to make about it.
2. For each attachment: get its original binary bytes, compute SHA-256 over those bytes
   (this is `content_hash`, §6.1), then base64-encode those same bytes into `data`.
3. Build the JSON envelope per §8.
4. Compute `integrity.payload_hash`: take the envelope, strip `attachments[].data` and
   `integrity.payload_hash` (keeping `integrity.algorithm`/`integrity.canonicalization`),
   canonicalise per RFC 8785 (§6.2), and SHA-256 the resulting UTF-8 bytes.
5. Send the JSON to whatever imports it into Tracepack (today: `importEvidencePayload` from
   this package, called from the workspace app; there is no network endpoint — Tracepack is
   local-first, so "sending" means handing the JSON to the same browser session).
6. On success you get back the ids of every `EvidenceItem` created. On failure you get a
   single error naming exactly what failed and why — see §10.

Before sending your first real payload, reproduce every vector in
`packages/evidence-sdk/test-vectors/` exactly (the §6.1 and §6.2 vectors above are that
directory's `content-hash/` and `payload-hash/` vectors; `validation/` covers §10's table). If
any vector doesn't match, the bug is in your implementation, not Tracepack's.

See `tests/fixtures/generic-analysis-tool.json` for a complete, valid example from a
hypothetical third-party review-pattern analyzer — the only example fixture, deliberately not
Spendmita-branded, because this format is not Spendmita's. (When this package is implemented,
that fixture's `integrity.canonicalization` must be updated to `"RFC8785"` to match §6.2.)

## 12. A producer's attachment is not a trusted attachment

Nothing about `schema_version`, hash verification, or provenance attribution implies Tracepack
trusts the *content* of what a producer sends — only that the bytes weren't altered in
transit (§6), and even that only proves integrity, never authorship or truth (§5, §13). A PDF
handed over via this format goes through exactly the same PII scan a manually-uploaded PDF
does (`document-engine.inspectPdf`, see `src/import.ts`): the resulting `privacyFindings`
start `decision: "unreviewed"` and land in Tracepack's existing redact-or-keep review queue
before the item can appear in an export. The producer is an untrusted third party for this
purpose exactly as much as a file a person drags in manually — "an external tool checked this
already" is never assumed.

## 13. What `payload_hash` and `content_hash` actually protect against

Both hashes live *inside the envelope they protect* — `payload_hash` is a field within the
same JSON object it's computed over (minus itself), and `content_hash` travels alongside the
attachment it describes in the same unsigned payload. That placement has a specific,
important security consequence worth stating plainly rather than leaving implicit:

**Anyone capable of modifying the payload is also capable of recomputing a valid hash for
their modified version.** These hashes are not tamper-proof and must never be described as
such. What they actually protect against is narrower and still useful:

- **Accidental corruption in transit** — truncation, encoding mangling, a copy-paste that
  dropped a character, a lossy intermediate system re-serialising the JSON and reordering or
  reformatting it unexpectedly.
- **Comparison against a separately known-good hash** — if a `payload_hash` or
  `content_hash` is recorded somewhere *outside* the payload itself (a producer's own log, a
  separate audit trail, a value read aloud over a phone call), the hash inside the payload can
  be checked against that independent record. The hash is doing real work there — just not
  the work of proving who sent the payload to Tracepack.
- **Internal consistency** — confirming that the attachment bytes Tracepack decoded really are
  the bytes the structured claims (which may reference the attachment, e.g. via
  `attachment_ref`) were talking about, at least as far as what arrived in this one payload
  goes.

**What they do not protect against:** a producer (malicious or merely mistaken) constructing a
payload with false claims from scratch and correctly hashing it — the hash will validate
perfectly, because it was computed correctly, over content that happens to be untrue or
falsely attributed. This is the same point made in §5 about producer identity, restated here
because it applies just as much to the *content* of a payload as to who claims to have sent
it: **integrity is not truth, and integrity is not authentication.** Distinguishing the three:

| Mechanism | What it establishes | What it does not establish |
|---|---|---|
| `attachments[].content_hash` (§6.1) | The stored bytes match the bytes this specific hash was computed from | That the attachment is authentic, unaltered from whatever it depicts, or that any claim about it is accurate |
| `integrity.payload_hash` (§6.2) | The structured claims are exactly what was hashed — no corruption or unnoticed edit since | That the claims are true, or that the declared producer actually computed this hash |
| Authenticated producer signatures | Out of scope for v1 entirely (§5) — reserved for a future signature layer | N/A — doesn't exist yet |

## 14. Decision Log

Eight ambiguities were identified in a pre-implementation review of the previous revision of
this document. Each is listed with its resolution and reasoning; full detail is in the
cross-referenced section.

1. **Attachment hashing terminology (§6.1).** *Ambiguity:* §10 (formerly) described the hash
   target as "raw (undecoded-from-base64) bytes," which reads ambiguously — it could be
   (mis)read as "hash the base64 string, just don't decode it first." *Resolution:* rewrote
   §6.1 as an explicit numbered procedure (binary bytes → hash → base64-encode for transport →
   decode → re-hash → compare) with the sentence "the base64 text is never the hashing target,
   in either direction" stated outright, plus a computed, verified test vector. No behaviour
   changed — the reference implementation (`canonicalize.ts`'s `sha256Hex`, called on decoded
   bytes in `import.ts`) was already doing this correctly; only the prose was ambiguous.

2. **`category_hint` (§8).** *Ambiguity:* the field risked leaking a Tracepack-specific
   concept (template category ids) into a format meant to be usable without any knowledge of
   Tracepack's internals. *Resolution:* removed. Checked the reference implementation first —
   `payload.category_hint` is never actually read anywhere in `import.ts`; category resolution
   has always required the caller to pass an explicit `categoryId`. A field that is validated
   but never consulted provides no real interoperability benefit while still being a
   vendor-specific concept in a vendor-neutral schema, so this was a clear case for the
   "prefer vendor-neutral" default rather than a close call. Tracepack-side category
   suggestion (if wanted) can be derived from `evidence_type`/`source_url` the same way
   `apps/workspace/src/captures.ts` already heuristically categorises webpage captures — that
   logic belongs entirely on Tracepack's side of the boundary.

3. **Producer identity and authentication (§5).** *Ambiguity:* the document didn't explicitly
   say that `source.producer_id`/`producer_name` are self-asserted and unverified, which risks
   the UI or export copy accidentally implying a verified identity. *Resolution:* added §5,
   stating plainly that v1 has no cryptographic producer authentication, that both hashes
   prove integrity rather than authorship, and requiring UI/export copy to say "declared" or
   "reported by," never "verified." No schema or behaviour change — `export-engine`'s existing
   wording ("Reported by *<producer>*. Not independently verified by Tracepack.") already
   matched this before the gap in the document was noticed, so this was a documentation gap
   with correct existing behaviour, not a bug.

4. **All-or-nothing import claim vs. real storage architecture (§10).** *Ambiguity:* the
   document claimed strict all-or-nothing atomicity for the entire import including
   persistence, which the actual `packages/storage` API (separate `saveEvidenceFile` calls per
   attachment, plus a separate caller-issued `saveProject`) does not currently provide.
   *Resolution:* inspected `packages/storage/src/index.ts`, `packages/evidence-core/src/index.ts`,
   and the existing import paths in `apps/workspace` directly. Confirmed: (a) the in-memory
   validation-then-mutation phase genuinely is all-or-nothing today; (b) the storage-write
   phase is not currently wrapped in one transaction, and can leave an orphaned-but-harmless
   blob on a rare mid-import failure; (c) `deleteProject` already proves multi-store atomic
   transactions are possible with the `idb` library in use, via
   `db.transaction(["projects","files"],"readwrite")`. Chose the smallest correct fix per the
   given menu of options: a narrowly scoped new `packages/storage` function, in the same shape
   as `deleteProject`, that wraps the project write and all attachment blob writes in one
   transaction — used by this package's import path specifically, not a redesign of
   `packages/storage`'s schema or of other import paths' existing calls. Deferred to
   implementation (§16); the document's atomicity claim was weakened to accurately describe
   today's real guarantee in the meantime.

5. **Canonicalisation interoperability (§6.2).** *Ambiguity:* "a subset of RFC 8785" is not
   precise enough for independent implementations to converge, particularly for the open
   `metadata`/`observations[].data` fields, where the previous subset's simplified number
   handling was reasoned to be "unnecessary" on the mistaken assumption that only the
   schema's own plain fields would ever need canonicalising. *Resolution:* switched to full,
   unmodified RFC 8785 (`integrity.canonicalization: "RFC8785"`) rather than continuing to
   maintain a bespoke near-standard with no existing library or independently-published test
   vectors in any other language. Documented, with a directly-verified example, the one place
   RFC 8785's behaviour is genuinely subtle and worth calling out explicitly: UTF-16
   code-unit key ordering can diverge from Unicode code-point ordering for supplementary-plane
   characters used as object keys. Added a full canonicalisation test vector (§6.2) alongside
   the attachment-hash vector (§6.1). This is a payload-shape change (the
   `integrity.canonicalization` literal value), acceptable because `schema_version` is still
   pre-release (see the status note at the top of this document).

6. **Payload integrity vs. authenticated signatures (§13).** *Ambiguity:* `payload_hash`
   lives inside the same unsigned envelope it protects, and the document didn't explicitly
   state the security consequence of that. *Resolution:* added §13, stating directly that
   anyone able to modify a payload can also recompute a valid hash for it, that this is a
   consistency/corruption check rather than tamper-proof integrity, and a table distinguishing
   attachment-byte integrity, payload-consistency checking, and authenticated signatures
   (out of scope for v1, see §5) as three genuinely different properties that must not be
   conflated in documentation, UI copy, or future code comments.

7. **Attachment-less evidence semantics (§6.3).** *Ambiguity:* whether the synthesized
   `text/plain` blob for a zero-attachment payload is compatible with existing
   `EvidenceItem`/storage/export behaviour, and whether it counts as evidential content in its
   own right. *Resolution:* confirmed compatibility directly — `sourceType: "note"` already
   exists and is already handled correctly by storage, `export-engine`'s note-rendering
   branch, and the workspace UI's note preview, with zero special-casing required; no new
   `SourceType` is introduced. Clarified explicitly that the synthesized text is an
   implementation artifact serving the current one-item-one-blob model, not itself
   Tracepack-authored or original-source content, and must be labelled as a rendering of the
   producer's claims (the existing rendering already does this; the document now says so
   explicitly rather than leaving it implicit). Clarified that `contentHash` hashes the
   deterministic bytes of that exact rendering, which must therefore be a deterministic
   function of the observations (no timestamps or random ids inside the rendered text).

8. **This review itself.** Produced the final mapping (§2, confirmed unchanged by the above —
   none of the eight resolutions alter the N-attachments-to-N-items mapping), the package/type
   modification list and v2 deferral list (§16), and the remaining-blocker check (§17).

## 15. Explicitly deferred to v2

None of the following exist in v1, and none should be added opportunistically while resolving
the items above:

- **Authenticated producer signatures** (§5) — digital signatures, public-key verification, a
  trust/allow-list of known producer keys. Likely shape: a signature layer wrapping the v1
  envelope, so today's unsigned payloads stay valid inputs to it, rather than a breaking
  schema change.
- **Remote attachment references** (§7) — an `attachments[].uri` alternative to inline
  base64, with explicit user confirmation, an allow-list/origin check, and tested
  timeout/failure behaviour, none of which exist today.
- **Multipart/bundle transport** (§7) — a zip of one envelope plus sibling attachment files,
  as a transport detail layered on the same v1 schema rather than a schema change.
- **Multiple producers / provenance chains within one envelope** (§4) — v1's
  `EvidenceProvenance` is one producer per item, matching one producer per envelope. Claims
  aggregated from more than one upstream producer into a single envelope would need
  per-observation provenance instead of the current per-item provenance, which is a schema
  change, not a v1 clarification.
- **Category information in the payload** (§8, §14 item 2) — deliberately removed rather than
  retained; if a future version reintroduces any Tracepack-category-adjacent concept, it
  should be justified by a concrete cross-producer need at that time, not restored by default.

## 16. What implementing this revision requires touching

**Status: implemented.** The items below were originally written as a forward-looking list
before implementation started; they are kept here, updated to past tense, as the record of what
actually changed. (This section's own opening line used to warn that the package "does not yet
reflect these eight resolutions" — it now does.)

- **`packages/evidence-interchange/src/types.ts`** — removed `category_hint` from
  `TracepackEvidencePayloadV1`.
- **`packages/evidence-interchange/src/validate.ts`** — removed the `category_hint` zod field;
  updated the `integrity.canonicalization` literal from `"tracepack-jcs-subset-v1"` to
  `"RFC8785"`.
- **`packages/evidence-interchange/src/canonicalize.ts`** — replaced the old hand-rolled
  `sortValue`/`JSON.stringify` canonicalizer with the `canonicalize` npm package (erdtman,
  zero dependencies), a real RFC 8785 implementation rather than a re-hand-rolled one.
  Cross-checked against the RFC 8785 authors' own published test vectors (not just this
  package's prior code) — see below.
- **`packages/evidence-interchange/schema/tracepack-evidence.v1.json`** — removed
  `category_hint`; updated the `canonicalization` const to `"RFC8785"`.
- **`packages/evidence-interchange/tests/fixtures/generic-analysis-tool.json`** — removed
  `category_hint`; recomputed `integrity.payload_hash` under RFC 8785 and updated
  `canonicalization`.
- **`packages/evidence-interchange/tests/*.test.ts`** — updated all assertions referencing
  `category_hint` or the old canonicalization literal. Added a persistence-phase-failure test
  (`tests/import.test.ts`) distinct from the existing validation-failure tests, per §10 —
  it mocks `saveProjectAndFiles` itself rejecting, and asserts the caller's original project
  object is left untouched and no partial success is reported. Added the §6.1 and §6.2 worked
  test vectors as pinned assertions in `tests/canonicalize.test.ts`. Added the five official
  RFC 8785 test vectors (`values`, `arrays`, `french`, `structures`, `weird`) published by the
  standard's own authors at `github.com/cyberphone/json-canonicalization/tree/master/testdata`
  as literal fixture files under `tests/fixtures/rfc8785/`, loaded via Vite's `?raw` import
  suffix rather than retyped by hand (an earlier hand-typed attempt at this corrupted the
  Unicode content and was caught and discarded before it shipped). Comparing this package's
  actual `canonicalizeJson()` against the standard's own worked examples — independent of the
  `canonicalize` library and of anything previously written in this repository — is a stronger
  cross-check than comparing against a second library alone, since a second library could
  coincidentally share the same bug where the standard's own examples cannot be wrong by
  definition.
- **`packages/storage/src/index.ts`** — added `saveProjectAndFiles(project, files)`, modeled on
  `deleteProject`'s existing multi-store transaction pattern. Its responsibility is kept
  deliberately narrow: persist one project record plus a set of file blobs in a single
  IndexedDB transaction, and nothing else — no reads, no partial-write modes, no options.
  Every existing exported function (`listProjects`, `getProject`, `saveProject`,
  `saveEvidenceFile`, `getEvidenceFile`, `deleteProject`) is unchanged. Getting real atomicity
  right required three fixes found only by testing against `fake-indexeddb`, not by inspection:
  a synchronous validation error from `put()` (e.g. an uncloneable value) does not auto-abort
  the transaction the way an async failure does, so `transaction.abort()` must be called
  explicitly on any error; calling `abort()` makes `transaction.done` reject, which becomes an
  unhandled rejection unless a no-op observer is attached to it separately; and every write
  (the project plus every file) must be queued synchronously in one block before any `await`,
  because awaiting between queued writes lets the transaction auto-commit prematurely before a
  later failure is detected. `packages/storage/tests/storage.test.ts` covers the success case,
  the rollback-on-failure case, and that a failed transaction never disturbs previously
  committed state.
- **`packages/evidence-interchange/src/import.ts`** — now calls `saveProjectAndFiles` once with
  the full derived project and a `Map` of every attachment blob, replacing the old per-item
  `saveEvidenceFile` loop that could partially succeed. `renderObservationsAsText` (used for
  attachment-less payloads, §6.3/§12) was rewritten to prepend an explicit
  "GENERATED BY TRACEPACK" banner stating in plain language that the note is a rendering of
  claims reported by the named producer, not an original document the producer supplied, and
  that its hash proves only that this rendering is intact — never that an original external
  artifact existed. The rendering is deterministic (no timestamps or non-deterministic
  ordering), verified by a test asserting two imports of the same payload produce the same
  `contentHash`.
- **`packages/export-engine/src/index.ts`** — this section originally said no changes were
  required here; that turned out to be wrong. `buildManifest` was missing `provenance` and
  `observations` on each per-item manifest entry entirely — a real gap found while
  implementing §5, not a hypothetical one — and has been extended to include them. A new
  `producerIdentityNotice` field was also added to the manifest (populated only when at least
  one included item carries provenance), stating plainly that producer identity is
  self-asserted by the producer and not independently verified or cryptographically confirmed
  by Tracepack — the same caveat the existing PDF observation page already carried
  ("Reported by *<producer>*. Not independently verified by Tracepack."), now also present in
  the machine-readable manifest so an integrator reading only the JSON cannot miss it.
- **No changes required** to `packages/evidence-core` (the `EvidenceProvenance`/
  `ExternalObservation` types and `addEvidence` were unaffected by all eight resolutions),
  `packages/template-engine`, or `packages/document-engine`.

## 17. Remaining blockers for an independent producer

Re-running this document's own acceptance test — could a developer who has never seen the
Tracepack source implement a conforming producer in another language, understand exactly what
its hashes and provenance do and do not prove, and have Tracepack import it without relying on
undocumented assumptions — against this revision:

- Hashing (§6.1, §6.2): unambiguous procedure plus two directly-computed, verifiable test
  vectors. **No blocker.**
- Canonicalisation (§6.2): a named, real IETF standard with existing libraries in every major
  language, plus the one genuinely subtle edge case (supplementary-plane key ordering)
  called out explicitly with a verified example. **No blocker.**
- What the hashes and provenance do and do not prove (§5, §13): stated directly, with a
  table, and cross-referenced everywhere the concepts recur. **No blocker.**
- Payload shape (§8) and failure behaviour (§10): a closed schema, an exhaustive
  condition/behaviour table, and an honest (not overstated) description of the storage-layer
  guarantee. **No blocker.**
- Storage-layer atomicity (§10, §14 item 4, §16): `packages/storage`'s
  `saveProjectAndFiles` now exists, is narrowly scoped to exactly persist-project-plus-blobs,
  and its atomicity is verified by real tests against `fake-indexeddb` (success, rollback-on-
  failure, and non-disturbance of previously committed state). This was the one open item
  flagged in the prior revision of this section as still needing resolution on Tracepack's
  side; it is now resolved. As before, a producer's contract never depended on this — "send a
  conforming payload and receive success or a specific named failure" — and still doesn't.
  **No blocker.**
- Producer identity remains self-asserted, not cryptographically authenticated, in v1 (§5).
  This is a deliberate, documented scope boundary rather than an oversight, and it is now
  surfaced consistently everywhere producer identity is shown or exported: the PDF observation
  page, the JSON manifest's new `producerIdentityNotice`, and this document. **No blocker**,
  provided no future change to the UI or export output ever implies verification that does not
  exist — that constraint is the actual acceptance criterion here, not any particular wording.
- Clean-room producer verification: **done**, not merely claimed. Re-run against the final
  implementation (post `category_hint` removal, post RFC 8785 adoption) at
  `examples/producers/consumer-rights-helper/` — a producer package with no `@tracepack/*`
  imports in its payload-construction code, using an RFC 8785 library independent of the one
  Tracepack's own `canonicalize.ts` wraps (`json-canonicalize`, not `canonicalize`). Its test
  harness feeds the resulting payload to the real import/storage/export pipeline and asserts
  every step in this section's acceptance criteria below. **No blocker.**

No other undocumented assumption was found. This revision has been implemented, independently
verified, and is frozen; the package, its tests, this document, and the clean-room producer
example are in sync as of this writing.

## 18. Package layout change: `@tracepack/evidence-sdk` (Phase 5)

**This is an internal reorganisation, not a contract change.** `schema_version: 1` — the wire
format, the JSON Schema content, and the RFC 8785 canonicalization/hashing procedure in §6 — is
unchanged by anything below. Nothing here reopens the freeze in §17.

`src/types.ts`, `src/validate.ts`, `src/canonicalize.ts`, and `schema/tracepack-evidence.v1.json`
moved out of this package into a new sibling, `packages/evidence-sdk`, published as
`@tracepack/evidence-sdk`. The reason: those four files never actually depended on
`@tracepack/document-engine` or `@tracepack/storage` — only `zod` and `canonicalize`, both
ordinary npm packages that run anywhere. Everything else in this package
(`src/import.ts`'s `importEvidencePayload`) is genuinely Tracepack-internal — it calls
`document-engine`'s PDF scanner and `storage`'s IndexedDB writer, neither of which makes sense
outside a browser running Tracepack itself.

Before this change, a producer who wanted tested validation/canonicalization code instead of
hand-rolling §3's hashing procedure had no way to depend on just that — importing
`@tracepack/evidence-interchange` would have pulled in `document-engine` and `storage` as
transitive dependencies, both of which assume a browser (`pdfjs-dist`, IndexedDB) and neither of
which a producer needs. `@tracepack/evidence-sdk` has zero such dependencies and runs under
plain Node.

`@tracepack/evidence-interchange`'s public exports are unchanged — `index.ts` re-exports the
same names from `@tracepack/evidence-sdk` now instead of local files, so nothing importing
`@tracepack/evidence-interchange` (including `apps/workspace` and this package's own
`import.ts`) needed to change. The `PRODUCER_GUIDE.md` link to the JSON Schema now points at its
new location, and gained a callout offering the SDK as an alternative to hand-rolling §3.
