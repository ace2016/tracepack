import {
  attestationStatementBytes,
  computeAttestationStatementHash,
} from "@tracepack/attestation";

import type {
  AttestationStatementV1,
  SignedAttestationV1,
} from "@tracepack/attestation";

import {
  signWithSigstore,
} from "./sign";

import type {
  SigstoreSigningOptions,
} from "./types";

export async function signAttestationWithSigstore(
  statement: AttestationStatementV1,
  options: SigstoreSigningOptions = {},
): Promise<SignedAttestationV1> {
  const payload =
    attestationStatementBytes(
      statement,
    );

  const contentDigest =
    await computeAttestationStatementHash(
      statement,
    );

  const signed =
    await signWithSigstore(
      payload,
      options,
    );

  return {
    statement,
    signature: {
      method: "sigstore",
      content_digest: {
        algorithm: "sha256",
        value: contentDigest,
      },
      bundle_media_type:
        signed.bundleMediaType,
      bundle:
        signed.bundle,
    },
  };
}
