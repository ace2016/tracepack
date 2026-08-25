import {
  attestationStatementBytes,
  computeAttestationStatementHash,
} from "./canonicalize";
import type {
  AttestationVerificationResultV1,
  JsonObject,
  SignedAttestationV1,
  VerifiedSigstoreIdentityV1,
} from "./types";
import {
  safeParseSignedAttestation,
} from "./validate";

export type SigstoreBundleVerifier = (
  input: {
    payload: Uint8Array;
    bundle: JsonObject;
    bundleMediaType: string;
  },
) => Promise<VerifiedSigstoreIdentityV1>;

export async function verifySignedAttestation(
  input: unknown,
  verifySigstoreBundle:
    SigstoreBundleVerifier,
): Promise<AttestationVerificationResultV1> {
  const parsed =
    safeParseSignedAttestation(input);

  if (!parsed.success) {
    return {
      valid: false,
      reason: "invalid_structure",
      errors: parsed.errors,
    };
  }

  const attestation:
    SignedAttestationV1 = parsed.data;

  const actualDigest =
    await computeAttestationStatementHash(
      attestation.statement,
    );

  if (
    actualDigest !==
    attestation.signature
      .content_digest.value
  ) {
    return {
      valid: false,
      reason: "content_digest_mismatch",
    };
  }

  let verifiedIdentity:
    VerifiedSigstoreIdentityV1;

  try {
    verifiedIdentity =
      await verifySigstoreBundle({
        payload:
          attestationStatementBytes(
            attestation.statement,
          ),
        bundle:
          attestation.signature.bundle,
        bundleMediaType:
          attestation.signature
            .bundle_media_type,
      });
  } catch (error) {
    return {
      valid: false,
      reason:
        "sigstore_verification_failed",
      errors: [
        error instanceof Error
          ? error.message
          : "Sigstore verification failed",
      ],
    };
  }

  const expected =
    attestation.statement.signer
      .expected_identity;

  if (
    expected &&
    (expected.issuer !==
      verifiedIdentity.issuer ||
      expected.subject !==
        verifiedIdentity.subject)
  ) {
    return {
      valid: false,
      reason: "identity_mismatch",
    };
  }

  return {
    valid: true,
    attestation,
    verified_identity:
      verifiedIdentity,
    identity_binding: expected
      ? "matched"
      : "not_declared",
  };
}
