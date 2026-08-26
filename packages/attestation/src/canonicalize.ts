import canonicalize from "canonicalize";
import type {
  AttestationStatementV1,
} from "./types";

function assertCanonicalJsonValue(
  value: unknown,
  seen: Set<object> = new Set(),
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Value cannot be represented as canonical JSON.",
      );
    }

    return;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError(
        "Value cannot be represented as canonical JSON.",
      );
    }

    seen.add(value);

    for (
      let index = 0;
      index < value.length;
      index += 1
    ) {
      if (!(index in value)) {
        throw new TypeError(
          "Value cannot be represented as canonical JSON.",
        );
      }

      assertCanonicalJsonValue(
        value[index],
        seen,
      );
    }

    seen.delete(value);
    return;
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    const prototype =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new TypeError(
        "Value cannot be represented as canonical JSON.",
      );
    }

    if (seen.has(value)) {
      throw new TypeError(
        "Value cannot be represented as canonical JSON.",
      );
    }

    if (
      Object.getOwnPropertySymbols(value)
        .length > 0
    ) {
      throw new TypeError(
        "Value cannot be represented as canonical JSON.",
      );
    }

    seen.add(value);

    for (
      const key of Object.keys(value)
    ) {
      assertCanonicalJsonValue(
        (
          value as Record<
            string,
            unknown
          >
        )[key],
        seen,
      );
    }

    seen.delete(value);
    return;
  }

  throw new TypeError(
    "Value cannot be represented as canonical JSON.",
  );
}

export function canonicalizeJson(
  value: unknown,
): string {
  assertCanonicalJsonValue(value);

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
