// Canonicalisation ("RFC8785") and hashing helpers. See SPEC.md section 6.2 for what this
// proves and does not prove, and why v1 uses real, unmodified RFC 8785 (JSON Canonicalization
// Scheme) rather than a hand-rolled subset — the open `metadata`/`observations[].data`
// extension points can contain content a bespoke canonicalizer's simplified number/Unicode
// handling could get wrong in ways that diverge across languages, which is exactly the
// interoperability risk depending on the real standard avoids.
//
// `canonicalize` (erdtman/canonicalize on npm, zero dependencies) is used rather than a
// re-hand-rolled implementation, and was verified — not just trusted — against all five
// official RFC 8785 test vectors published by the RFC's own reference implementation
// (github.com/cyberphone/json-canonicalization/tree/master/testdata) before being adopted
// here; see tests/canonicalize.test.ts for that verification kept as a permanent regression
// test, not a one-off check.
import canonicalize from "canonicalize";
import type { TracepackEvidencePayloadV1 } from "./types";

/** RFC 8785 canonical JSON serialisation: keys sorted by UTF-16 code unit, array order
 *  preserved, no insignificant whitespace, exact ECMA-262 number formatting. */
export function canonicalizeJson(value: unknown): string {
  return canonicalize(value) ?? "null";
}

export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The payload integrity hash: canonicalised envelope content, excluding attachment bytes
 * (covered separately by each attachment's own content_hash) and excluding
 * integrity.payload_hash itself (a hash cannot include its own value).
 */
export async function computePayloadHash(payload: TracepackEvidencePayloadV1): Promise<string> {
  const attachmentsWithoutBytes = payload.attachments.map(({ data: _data, ...rest }) => rest);
  const hashable = {
    ...payload,
    attachments: attachmentsWithoutBytes,
    integrity: { algorithm: payload.integrity.algorithm, canonicalization: payload.integrity.canonicalization },
  };
  return sha256Hex(canonicalizeJson(hashable));
}

const HEX_64 = /^[0-9a-f]{64}$/;
export function isValidSha256Hex(value: unknown): value is string {
  return typeof value === "string" && HEX_64.test(value);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
