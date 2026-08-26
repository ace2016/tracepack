import canonicalize from "canonicalize";
import type {
  AttestationStatementV1,
} from "./types";

export function canonicalizeJson(
  value: unknown,
): string {
  const result =
    canonicalize(value);

  if (result === undefined) {
    throw new TypeError(
      "Value cannot be represented as canonical JSON.",
    );
  }

  return result;
}

export function attestationStatementBytes(
  statement: AttestationStatementV1,
): Uint8Array {
  return new TextEncoder().encode(
    canonicalizeJson(statement),
  );
}

export async function sha256Hex(
  input: Uint8Array | string,
): Promise<string> {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as BufferSource,
  );

  return Array.from(
    new Uint8Array(digest),
    (byte) =>
      byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function computeAttestationStatementHash(
  statement: AttestationStatementV1,
): Promise<string> {
  return sha256Hex(
    attestationStatementBytes(statement),
  );
}

export function isValidSha256Hex(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{64}$/.test(value)
  );
}
