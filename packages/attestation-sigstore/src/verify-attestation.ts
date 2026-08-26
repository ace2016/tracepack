import {
  verifySignedAttestation,
} from "@tracepack/attestation";

import type {
  AttestationVerificationResultV1,
} from "@tracepack/attestation";

import {
  verifyWithSigstore,
} from "./verify";

import type {
  SigstoreIdentityPolicy,
} from "./types";

export async function verifyAttestationWithSigstore(
  input: unknown,
  policy: SigstoreIdentityPolicy = {},
): Promise<AttestationVerificationResultV1> {
  return verifySignedAttestation(
    input,
    async ({
      payload,
      bundle,
      bundleMediaType,
    }) => {
      const embeddedMediaType =
        typeof bundle.mediaType === "string"
          ? bundle.mediaType
          : undefined;

      if (
        embeddedMediaType !==
        bundleMediaType
      ) {
        throw new Error(
          `Sigstore bundle media type mismatch: envelope declares "${bundleMediaType}" but bundle declares "${embeddedMediaType ?? "missing"}".`,
        );
      }

      const result =
        await verifyWithSigstore(
          payload,
          bundle,
          policy,
        );

      return result;
    },
  );
}
