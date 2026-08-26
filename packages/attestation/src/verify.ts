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
  createVerificationReport,
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

function markStagesSkippedAfter(
  report: AttestationVerificationReportV1,
  failedStage:
    | "structure"
    | "canonicalization"
    | "content_digest",
): void {
  const order = [
    "structure",
    "canonicalization",
    "content_digest",
    "bundle",
    "trusted_root",
    "certificate",
    "transparency_log",
    "timestamp",
    "signature",
    "identity",
    "policy",
  ] as const;

  const failedIndex =
    order.indexOf(failedStage);

  for (
    let index = failedIndex + 1;
    index < order.length;
    index += 1
  ) {
    const stage =
      order[index];

    if (stage === undefined) {
      continue;
    }

    setVerificationStage(
      report,
      stage,
      "skipped",
      {
        message:
          `Skipped because verification failed at ${failedStage}.`,
      },
    );
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
  const preSigstoreReport =
    createVerificationReport();

  const parsed =
    safeParseSignedAttestation(input);

  if (!parsed.success) {
    setVerificationStage(
      preSigstoreReport,
      "structure",
      "failed",
      {
        code:
          "ATTESTATION_INVALID_STRUCTURE",
        message:
          "Attestation structure validation failed.",
      },
    );

    markStagesSkippedAfter(
      preSigstoreReport,
      "structure",
    );

    return {
      valid: false,
      reason: "invalid_structure",
      errors: parsed.errors,
      report:
        preSigstoreReport,
    };
  }

  setVerificationStage(
    preSigstoreReport,
    "structure",
    "passed",
  );

  const attestation:
    SignedAttestationV1 = parsed.data;

  let actualDigest: string;

  try {
    actualDigest =
      await computeAttestationStatementHash(
        attestation.statement,
      );

    setVerificationStage(
      preSigstoreReport,
      "canonicalization",
      "passed",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Attestation canonicalization failed.";

    setVerificationStage(
      preSigstoreReport,
      "canonicalization",
      "failed",
      {
        code:
          "ATTESTATION_CANONICALIZATION_FAILED",
        message,
      },
    );

    markStagesSkippedAfter(
      preSigstoreReport,
      "canonicalization",
    );

    return {
      valid: false,
      reason: "invalid_structure",
      errors: [message],
      report:
        preSigstoreReport,
    };
  }

  if (
    actualDigest !==
    attestation.signature
      .content_digest.value
  ) {
    setVerificationStage(
      preSigstoreReport,
      "content_digest",
      "failed",
      {
        code:
          "ATTESTATION_CONTENT_DIGEST_MISMATCH",
        message:
          "Attestation statement digest does not match the signed content digest.",
      },
    );

    markStagesSkippedAfter(
      preSigstoreReport,
      "content_digest",
    );

    return {
      valid: false,
      reason: "content_digest_mismatch",
      report:
        preSigstoreReport,
    };
  }

  setVerificationStage(
    preSigstoreReport,
    "content_digest",
    "passed",
  );

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
    if (
      report &&
      report.stages.some(
        (stage) =>
          stage.id === "identity",
      )
    ) {
      setVerificationStage(
        report,
        "identity",
        "failed",
        {
          code:
            "ATTESTATION_IDENTITY_MISMATCH",
          message:
            "Verified signer identity does not match the identity declared by the attestation.",
        },
      );
    }

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
