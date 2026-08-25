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
    }) => {
      const result =
        await verifyWithSigstore(
          payload,
          bundle,
          policy,
        );

      return result.identity;
    },
  );
}
