# tracepack-evidence v1 conformance test vectors

This directory is the actual interop contract for anyone implementing a `tracepack-evidence`
v1 producer or consumer in a language other than TypeScript. `SPEC.md` (in
`packages/evidence-interchange/`) explains *why* each rule exists; the files here are
machine-checkable pass/fail data an implementation can be run against without reading any of
this repository's own source code.

If you only read one file before implementing, read this one, then reproduce every vector
below in your own language before sending or accepting a single real payload.

## Layout

```
content-hash/    attachments[].content_hash vectors (SPEC.md section 6.1)
payload-hash/    integrity.payload_hash vectors (SPEC.md section 6.2)
validation/      schema/structural validation vectors -- valid and invalid payloads
```

### `content-hash/`

Each file has `original_content_utf8` (or, for binary content, `content_base64` alone),
`content_base64`, and `content_hash_sha256_hex`. To check your implementation:

1. Base64-decode `content_base64` into raw bytes.
2. SHA-256 those bytes.
3. Format as lowercase hex.
4. Confirm it equals `content_hash_sha256_hex`.

**Hash the decoded binary, never the base64 text itself.** Hashing the base64 string's own
UTF-8/ASCII bytes instead of what it decodes to is the single most common first-implementation
bug for this field (see SPEC.md section 6.1) -- it produces a completely different, silently
wrong hash with no error until the real consumer rejects the import.

### `payload-hash/`

Each file has `input_payload` (a complete, valid, self-consistent payload, including its own
correct `integrity.payload_hash`), `canonical_form_excluding_hash` (the exact RFC 8785 canonical
string that hash was computed from), and `payload_hash_sha256_hex` (the same value as
`input_payload.integrity.payload_hash`, given separately for convenience). To check your
implementation:

1. Take `input_payload`, remove `data` from every entry in `attachments[]`, and reduce
   `integrity` to only `{algorithm, canonicalization}` (drop `payload_hash`).
2. Canonicalize that object per RFC 8785 (JSON Canonicalization Scheme) -- key sorted by UTF-16
   code unit, no whitespace, exact ECMA-262 number formatting. Confirm the result matches
   `canonical_form_excluding_hash` byte for byte.
3. SHA-256 the canonical string's UTF-8 bytes, format as lowercase hex.
4. Confirm it equals `payload_hash_sha256_hex`.

Existing, independently-verified RFC 8785 test vectors (the canonicalization step alone, not
this format's field-exclusion rule) live at
`packages/evidence-sdk/tests/fixtures/rfc8785/` -- reproduce those first if your RFC 8785
implementation itself is unverified; they isolate the standard from this format's own rules.

### `validation/`

Each file is a standalone vector: `description`, `expected_valid` (`true`/`false`),
`expected_reason` (a human-readable explanation, not a machine-matched error string -- different
validator libraries format error messages and paths differently, and that formatting is
deliberately not part of this contract), `json_schema_alone_sufficient`, and `payload` (the
exact input to validate). `manifest.json` lists every vector file with its `expected_valid` and
`json_schema_alone_sufficient` values, for tooling that wants to iterate the set without parsing
every file.

**Read `json_schema_alone_sufficient` carefully.** A handful of rules in `SPEC.md` section 10's
table -- duplicate `attachments[].id`/`observations[].id`, a dangling `attachment_ref`, real
calendar-date validity for `capture_timestamp`, and forbidding `__proto__`/`constructor`/
`prototype` keys inside the intentionally-open `metadata` field -- are semantic or cross-field
rules that plain JSON Schema (draft 2020-12, no custom keywords) cannot express. For those
vectors, `json_schema_alone_sufficient` is `false`: the JSON Schema file alone will *accept* the
payload even though the full contract rejects it. **If you validate only against the `.json`
schema file and stop there, you will incorrectly accept those five kinds of payload.** A
conforming implementation must also apply the semantic rules from `SPEC.md` section 10's table,
not just the schema file, to reject them. This is a real, current limitation of treating the
JSON Schema file as the complete contract by itself, not a decoration -- it is exactly why this
directory (schema plus semantic rules plus worked vectors, together) is the actual interop
contract, not the schema file in isolation.

Run each `payload` through your own implementation of the rules in `SPEC.md` sections 8-10, and
confirm your validator's accept/reject decision matches `expected_valid`. A validator that agrees
with every vector here has covered the structural *and* the documented semantic edge cases this
format's own test suite covers -- it is not proof of full spec conformance (nothing here checks
attachment byte-hash verification against decoded data, for instance, since that requires an
actual attachment payload larger than convenient to inline in a fixture file), but it is a
strong, checkable floor.

## What this is not

These vectors check structure and hash procedures. They do not, and cannot, check whether a
payload's *claims* are true, or whether its declared producer identity is genuine -- see
`SPEC.md` sections 5 and 13, and `SECURITY.md`, for what this format does and does not prove.

## Keeping these in sync

If `SPEC.md` or the JSON Schema changes in a way that would change the expected outcome of any
vector here, the vector must be updated in the same change -- these files are read by
`packages/evidence-sdk/tests/test-vectors.test.ts`, so a drift between the spec and these
fixtures fails the test suite rather than going unnoticed.
