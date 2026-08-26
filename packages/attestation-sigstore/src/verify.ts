import {
  TUFError,
  ValidationError,
  VerificationError,
  verify,
} from "sigstore";

import type {
  SerializedBundle,
} from "@sigstore/bundle";


import {
  createVerificationReport,
  setVerificationStage,
} from "@tracepack/attestation";

import type {
  AttestationVerificationReportV1,
  JsonObject,
  VerifiedSigstoreIdentityV1,
} from "@tracepack/attestation";

import type {
  SigstoreIdentityPolicy,
  SigstoreRuntimeVerificationResult,
} from "./types";

function failureMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Sigstore verification failed.";
}

function markSkippedAfterBundleFailure(
  report: AttestationVerificationReportV1,
): void {
  for (const stage of [
    "trusted_root",
    "certificate",
    "transparency_log",
    "timestamp",
    "signature",
    "identity",
    "policy",
  ] as const) {
    setVerificationStage(
      report,
      stage,
      "skipped",
      {
        message:
          "Skipped because bundle validation failed.",
      },
    );
  }
}

export function markCryptographicSuccess(
  report: AttestationVerificationReportV1,
  bundle: SerializedBundle,
): void {
  for (const stage of [
    "trusted_root",
    "certificate",
    "transparency_log",
    "signature",
  ] as const) {
    setVerificationStage(
      report,
      stage,
      "passed",
    );
  }

  if (
    hasRfc3161Timestamps(
      bundle,
    )
  ) {
    setVerificationStage(
      report,
      "timestamp",
      "passed",
      {
        message:
          "RFC 3161 trusted timestamp verified by Sigstore.",
      },
    );

    report.evidence = {
      ...report.evidence,
      trusted_timestamp_verified:
        true,
    };

    return;
  }

  setVerificationStage(
    report,
    "timestamp",
    "skipped",
    {
      message:
        "No independent RFC 3161 timestamp was present.",
    },
  );
}

type SigstoreFailureStage =
  | "bundle"
  | "trusted_root"
  | "certificate"
  | "transparency_log"
  | "timestamp"
  | "signature";

type ClassifiedSigstoreFailure = {
  stage: SigstoreFailureStage;
  code: string;
};

function hasRfc3161Timestamps(
  bundle?: SerializedBundle,
): boolean {
  if (!bundle) {
    return false;
  }

  const value =
    bundle as unknown as {
      verificationMaterial?: {
        timestampVerificationData?: {
          rfc3161Timestamps?: unknown[];
        };
      };
    };

  const timestamps =
    value.verificationMaterial
      ?.timestampVerificationData
      ?.rfc3161Timestamps;

  return (
    Array.isArray(timestamps) &&
    timestamps.length > 0
  );
}

export function classifySigstoreFailure(
  error: unknown,
  bundle?: SerializedBundle,
): ClassifiedSigstoreFailure {
  if (error instanceof ValidationError) {
    return {
      stage: "bundle",
      code:
        "SIGSTORE_BUNDLE_INVALID",
    };
  }

  if (error instanceof TUFError) {
    return {
      stage: "trusted_root",
      code:
        "SIGSTORE_TRUST_ROOT_FAILED",
    };
  }

  if (error instanceof VerificationError) {
    if (
      error.code.startsWith(
        "TLOG_",
      )
    ) {
      return {
        stage:
          "transparency_log",
        code:
          "SIGSTORE_TRANSPARENCY_LOG_FAILED",
      };
    }

    switch (error.code) {
      case "CERTIFICATE_ERROR":
      case "PUBLIC_KEY_ERROR":
        return {
          stage: "certificate",
          code:
            "SIGSTORE_CERTIFICATE_FAILED",
        };

      case "TIMESTAMP_ERROR":
        if (
          hasRfc3161Timestamps(
            bundle,
          )
        ) {
          return {
            stage: "timestamp",
            code:
              "SIGSTORE_TIMESTAMP_FAILED",
          };
        }

        return {
          stage:
            "transparency_log",
          code:
            "SIGSTORE_TRANSPARENCY_LOG_FAILED",
        };

      case "SIGNATURE_ERROR":
        return {
          stage: "signature",
          code:
            "SIGSTORE_SIGNATURE_FAILED",
        };

      default:
        return {
          stage: "signature",
          code:
            "SIGSTORE_VERIFICATION_FAILED",
        };
    }
  }

  return {
    stage: "signature",
    code:
      "SIGSTORE_VERIFICATION_FAILED",
  };
}

function markCryptographicFailure(
  report: AttestationVerificationReportV1,
  error: unknown,
  message: string,
  bundle?: SerializedBundle,
): void {
  const failure =
    classifySigstoreFailure(
      error,
      bundle,
    );

  if (failure.stage === "bundle") {
    setVerificationStage(
      report,
      "bundle",
      "failed",
      {
        code:
          failure.code,
        message,
      },
    );

    markSkippedAfterBundleFailure(
      report,
    );

    return;
  }

  for (const stage of [
    "trusted_root",
    "certificate",
    "transparency_log",
    "timestamp",
    "signature",
  ] as const) {
    if (stage === failure.stage) {
      setVerificationStage(
        report,
        stage,
        "failed",
        {
          code:
            failure.code,
          message,
        },
      );

      continue;
    }

    setVerificationStage(
      report,
      stage,
      "skipped",
      {
        message:
          `Skipped because Sigstore verification failed at ${failure.stage}.`,
      },
    );
  }

  for (const stage of [
    "identity",
    "policy",
  ] as const) {
    setVerificationStage(
      report,
      stage,
      "skipped",
      {
        message:
          "Skipped because Sigstore verification did not complete.",
      },
    );
  }
}

type DetectedBundleFormat =
  | "sigstore-json"
  | "cosign-legacy"
  | "unknown";

function detectBundleFormat(
  value: JsonObject,
): DetectedBundleFormat {
  if (
    typeof value.mediaType === "string" &&
    value.mediaType.length > 0
  ) {
    return "sigstore-json";
  }

  if (
    typeof value.base64Signature === "string" &&
    typeof value.cert === "string" &&
    typeof value.rekorBundle === "object" &&
    value.rekorBundle !== null &&
    !Array.isArray(value.rekorBundle)
  ) {
    return "cosign-legacy";
  }

  return "unknown";
}

function parseBundle(
  value: JsonObject,
): SerializedBundle {
  const format =
    detectBundleFormat(value);

  if (format === "cosign-legacy") {
    throw new Error(
      "Legacy Cosign bundle detected. This adapter currently accepts Sigstore serialized JSON bundles only.",
    );
  }

  if (format === "unknown") {
    throw new Error(
      "Unrecognised Sigstore or Cosign bundle format.",
    );
  }

  if (
    typeof value.mediaType !== "string" ||
    value.mediaType.length === 0
  ) {
    throw new Error(
      "Sigstore bundle is missing mediaType.",
    );
  }

  if (
    typeof value.verificationMaterial !==
      "object" ||
    value.verificationMaterial === null ||
    Array.isArray(
      value.verificationMaterial,
    )
  ) {
    throw new Error(
      "Sigstore bundle is missing verificationMaterial.",
    );
  }

  return value as unknown as SerializedBundle;
}

type VerifiedSigner =
  Awaited<ReturnType<typeof verify>>;

function extractIdentity(
  signer: VerifiedSigner,
): VerifiedSigstoreIdentityV1 {
  const subject =
    signer.identity
      ?.subjectAlternativeName;

  const issuer =
    signer.identity
      ?.extensions
      ?.issuer;

  if (
    typeof issuer !== "string" ||
    issuer.length === 0
  ) {
    throw new Error(
      "Verified Sigstore signer is missing the certificate issuer identity.",
    );
  }

  if (
    typeof subject !== "string" ||
    subject.length === 0
  ) {
    throw new Error(
      "Verified Sigstore signer is missing the subject alternative name.",
    );
  }

  return {
    issuer,
    subject,
  };
}

export class SigstoreVerificationError
  extends Error {
  readonly report:
    AttestationVerificationReportV1;

  constructor(
    message: string,
    report:
      AttestationVerificationReportV1,
  ) {
    super(message);

    this.name =
      "SigstoreVerificationError";

    this.report = report;
  }
}

export async function verifyWithSigstore(
  payload: Uint8Array,
  bundle: JsonObject,
  policy: SigstoreIdentityPolicy = {},
): Promise<SigstoreRuntimeVerificationResult> {
  const report =
    createVerificationReport();

  let parsedBundle: SerializedBundle;

  try {
    parsedBundle =
      parseBundle(bundle);

    setVerificationStage(
      report,
      "bundle",
      "passed",
      {
        message:
          "Sigstore bundle structure accepted.",
      },
    );
  } catch (error) {
    const message =
      failureMessage(error);

    setVerificationStage(
      report,
      "bundle",
      "failed",
      {
        code:
          "SIGSTORE_BUNDLE_INVALID",
        message,
      },
    );

    markSkippedAfterBundleFailure(
      report,
    );

    throw new SigstoreVerificationError(
      message,
      report,
    );
  }

  setVerificationStage(
    report,
    "trusted_root",
    "pending",
    {
      message:
        "Sigstore trust verification is running.",
    },
  );

  let signer: VerifiedSigner;

  try {
    signer = await verify(
      parsedBundle,
      Buffer.from(payload),
    );
  } catch (error) {
    const message =
      failureMessage(error);

    markCryptographicFailure(
      report,
      error,
      message,
      parsedBundle,
    );

    throw new SigstoreVerificationError(
      message,
      report,
    );
  }

  markCryptographicSuccess(
    report,
    parsedBundle,
  );

  let identity:
    VerifiedSigstoreIdentityV1;

  try {
    identity =
      extractIdentity(signer);
  } catch (error) {
    const message =
      failureMessage(error);

    setVerificationStage(
      report,
      "identity",
      "failed",
      {
        code:
          "SIGSTORE_IDENTITY_MISSING",
        message,
      },
    );

    setVerificationStage(
      report,
      "policy",
      "skipped",
    );

    throw new SigstoreVerificationError(
      message,
      report,
    );
  }

  setVerificationStage(
    report,
    "identity",
    "passed",
    {
      message:
        "Signer identity extracted from verified certificate.",
    },
  );

  const issuerMatches =
    policy.certificateIssuer === undefined ||
    policy.certificateIssuer ===
      identity.issuer;

  const subjectMatches =
    policy.certificateIdentityURI ===
      undefined ||
    policy.certificateIdentityURI ===
      identity.subject;

  if (
    !issuerMatches ||
    !subjectMatches
  ) {
    const mismatches: string[] = [];

    if (!issuerMatches) {
      mismatches.push(
        "certificate issuer does not match configured policy",
      );
    }

    if (!subjectMatches) {
      mismatches.push(
        "certificate identity URI does not match configured policy",
      );
    }

    const message =
      `Sigstore identity policy rejected signer: ${mismatches.join(
        "; ",
      )}.`;

    setVerificationStage(
      report,
      "policy",
      "failed",
      {
        code:
          "SIGSTORE_IDENTITY_POLICY_MISMATCH",
        message,
      },
    );

    report.evidence = {
      ...report.evidence,
      certificate_issuer:
        identity.issuer,
      certificate_subject:
        identity.subject,
      transparency_log_verified:
        true,
    };

    throw new SigstoreVerificationError(
      message,
      report,
    );
  }

  setVerificationStage(
    report,
    "policy",
    "passed",
    {
      message:
        "Configured signer identity policy accepted.",
    },
  );

  report.evidence = {
    ...report.evidence,
    certificate_issuer:
      identity.issuer,
    certificate_subject:
      identity.subject,
    transparency_log_verified:
      true,
  };

  return {
    identity,
    report,
  };
}
