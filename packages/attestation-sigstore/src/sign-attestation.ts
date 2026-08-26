import {
  attestationStatementBytes,
  computeAttestationStatementHash,
  parseAttestationStatement,
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
  const statementSnapshot =
    parseAttestationStatement(
      statement,
    );

  const payload =
    attestationStatementBytes(
      statementSnapshot,
    );

  const contentDigest =
    await computeAttestationStatementHash(
      statementSnapshot,
    );

  const signed =
    await signWithSigstore(
      payload,
      options,
    );

  return {
    statement:
      statementSnapshot,
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
