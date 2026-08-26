import { sign } from "sigstore";

import type {
  JsonObject,
} from "@tracepack/attestation";

import type {
  SigstoreSigningOptions,
  SigstoreSigningResult,
} from "./types";

function asJsonObject(
  value: unknown,
): JsonObject {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      "Sigstore returned an invalid bundle.",
    );
  }

  return value as JsonObject;
}

function readBundleMediaType(
  bundle: JsonObject,
): string {
  const mediaType = bundle.mediaType;

  if (
    typeof mediaType !== "string" ||
    mediaType.length === 0
  ) {
    throw new Error(
      "Sigstore bundle is missing mediaType.",
    );
  }

  return mediaType;
}

export async function signWithSigstore(
  payload: Uint8Array,
  options: SigstoreSigningOptions = {},
): Promise<SigstoreSigningResult> {
  const bundle = await sign(
    Buffer.from(payload),
    {
      tsaServerURL:
        options.tsaServerURL,
      tlogUpload:
        options.tlogUpload ?? true,
      identityToken:
        options.identityToken,
    },
  );

  const json = asJsonObject(bundle);

  return {
    bundleMediaType:
      readBundleMediaType(json),
    bundle: json,
  };
}
