import {
  attestationStatementBytes,
  computeAttestationStatementHash,
} from "./canonicalize";
import type {
  AttestationVerificationReportV1,
  AttestationVerificationResultV1,
  JsonObject,
  SignedAttestationV1,
  VerifiedSigstoreIdentityV1,
} from "./types";
import {
  safeParseSignedAttestation,
} from "./validate";
import {
  setVerificationStage,
} from "./report";

function markPreSigstoreStagesPassed(
  report: AttestationVerificationReportV1,
): void {
  for (const stage of [
    "structure",
    "canonicalization",
    "content_digest",
  ] as const) {
    if (
      report.stages.some(
        (candidate) =>
          candidate.id === stage,
      )
    ) {
      setVerificationStage(
        report,
        stage,
        "passed",
      );
    }
  }
}

export interface SigstoreBundleVerificationSuccess {
  identity: VerifiedSigstoreIdentityV1;
  report?: AttestationVerificationReportV1;
}

export type SigstoreBundleVerifier = (
  input: {
    payload: Uint8Array;
    bundle: JsonObject;
    bundleMediaType: string;
  },
) => Promise<
  | VerifiedSigstoreIdentityV1
  | SigstoreBundleVerificationSuccess
>;

function reportFromError(
  error: unknown,
): AttestationVerificationReportV1 | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("report" in error)
  ) {
    return undefined;
  }

  const report =
    (error as {
      report?: unknown;
    }).report;

  if (
    typeof report !== "object" ||
    report === null ||
    !("stages" in report) ||
    !Array.isArray(
      (report as {
        stages?: unknown;
      }).stages,
    )
  ) {
    return undefined;
  }

  return report as
    AttestationVerificationReportV1;
}

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

  let report:
    AttestationVerificationReportV1
    | undefined;

  try {
    const verification =
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

    if ("identity" in verification) {
      verifiedIdentity =
        verification.identity;

      report =
        verification.report;

      if (report) {
        markPreSigstoreStagesPassed(
          report,
        );
      }
    } else {
      verifiedIdentity =
        verification;
    }
  } catch (error) {
    const failureReport =
      reportFromError(error);

    if (failureReport) {
      markPreSigstoreStagesPassed(
        failureReport,
      );
    }

    return {
      valid: false,
      reason:
        "sigstore_verification_failed",
      errors: [
        error instanceof Error
          ? error.message
          : "Sigstore verification failed",
      ],
      ...(failureReport
        ? {
            report:
              failureReport,
          }
        : {}),
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
      ...(report
        ? {
            report,
          }
        : {}),
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
    ...(report
      ? {
          report,
        }
      : {}),
  };
}
