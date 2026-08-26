import canonicalize from "canonicalize";
import type {
  AttestationStatementV1,
} from "./types.js";

function assertValidUnicodeString(
  value: string,
): void {
  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    const code =
      value.charCodeAt(index);

    if (
      code >= 0xd800 &&
      code <= 0xdbff
    ) {
      const next =
        value.charCodeAt(
          index + 1,
        );

      if (
        !Number.isFinite(next) ||
        next < 0xdc00 ||
        next > 0xdfff
      ) {
        throw new TypeError(
          "Value cannot be represented as canonical JSON.",
        );
      }

      index += 1;
      continue;
    }

    if (
      code >= 0xdc00 &&
      code <= 0xdfff
    ) {
      throw new TypeError(
        "Value cannot be represented as canonical JSON.",
      );
    }
  }
}

function snapshotCanonicalJsonValue(
  value: unknown,
  seen: Set<object> = new Set(),
): unknown {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    assertValidUnicodeString(value);
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Value cannot be represented as canonical JSON.",
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError(
        "Value cannot be represented as canonical JSON.",
      );
    }

    const ownKeys =
      Reflect.ownKeys(value);

    for (const key of ownKeys) {
      if (key === "length") {
        continue;
      }

      if (
        typeof key !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(key)
      ) {
        throw new TypeError(
          "Value cannot be represented as canonical JSON.",
        );
      }

      const index =
        Number(key);

      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= value.length
      ) {
        throw new TypeError(
          "Value cannot be represented as canonical JSON.",
        );
      }
    }

    seen.add(value);

    const snapshot: unknown[] = [];

    for (
      let index = 0;
      index < value.length;
      index += 1
    ) {
      const descriptor =
        Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );

      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        "get" in descriptor ||
        "set" in descriptor
      ) {
        throw new TypeError(
          "Value cannot be represented as canonical JSON.",
        );
      }

      snapshot.push(
        snapshotCanonicalJsonValue(
          descriptor.value,
          seen,
        ),
      );
    }

    seen.delete(value);
    return snapshot;
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

    const ownKeys =
      Reflect.ownKeys(value);

    const entries:
      Array<[string, unknown]> = [];

    seen.add(value);

    for (const key of ownKeys) {
      if (typeof key !== "string") {
        throw new TypeError(
          "Value cannot be represented as canonical JSON.",
        );
      }

      assertValidUnicodeString(key);

      const descriptor =
        Object.getOwnPropertyDescriptor(
          value,
          key,
        );

      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        "get" in descriptor ||
        "set" in descriptor
      ) {
        throw new TypeError(
          "Value cannot be represented as canonical JSON.",
        );
      }

      entries.push([
        key,
        snapshotCanonicalJsonValue(
          descriptor.value,
          seen,
        ),
      ]);
    }

    seen.delete(value);

    const snapshot:
      Record<string, unknown> = {};

    for (const [key, entryValue] of entries) {
      snapshot[key] = entryValue;
    }

    return snapshot;
  }

  throw new TypeError(
    "Value cannot be represented as canonical JSON.",
  );
}

export function canonicalizeJson(
  value: unknown,
): string {
  const snapshot =
    snapshotCanonicalJsonValue(value);

  const result =
    canonicalize(snapshot);

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

async function subtleCrypto():
  Promise<SubtleCrypto> {
  if (
    globalThis.crypto?.subtle
  ) {
    return globalThis.crypto.subtle;
  }

  /*
   * Node 18 does not expose global Web Crypto
   * consistently across supported execution
   * modes. Keep the normal browser/runtime path
   * free of a Node-only static import and load the
   * Node implementation only as a fallback.
   */
  try {
    const loadNodeCrypto =
      Function(
        "return import('node:crypto')",
      ) as () => Promise<{
        webcrypto?: {
          subtle?: SubtleCrypto;
        };
      }>;

    const nodeCrypto =
      await loadNodeCrypto();

    if (
      nodeCrypto.webcrypto?.subtle
    ) {
      return nodeCrypto.webcrypto.subtle;
    }
  } catch {
    // Fall through to the explicit runtime error.
  }

  throw new Error(
    "Web Crypto SHA-256 is unavailable in this runtime.",
  );
}

export async function sha256Hex(
  input: Uint8Array | string,
): Promise<string> {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input;

  const subtle =
    await subtleCrypto();

  const digest = await subtle.digest(
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
