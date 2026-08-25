import { verify } from "sigstore";

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

function markCryptographicSuccess(
  report: AttestationVerificationReportV1,
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

  setVerificationStage(
    report,
    "timestamp",
    "skipped",
    {
      message:
        "No independent TracePack timestamp assertion was made.",
    },
  );
}

function markCryptographicFailure(
  report: AttestationVerificationReportV1,
  message: string,
): void {
  setVerificationStage(
    report,
    "signature",
    "failed",
    {
      code:
        "SIGSTORE_VERIFICATION_FAILED",
      message,
    },
  );

  for (const stage of [
    "trusted_root",
    "certificate",
    "transparency_log",
    "timestamp",
    "identity",
    "policy",
  ] as const) {
    setVerificationStage(
      report,
      stage,
      "skipped",
      {
        message:
          "Cryptographic verification did not complete.",
      },
    );
  }
}

type DetectedBundleFormat =
  | "sigstore-v0.3"
  | "cosign-legacy"
  | "unknown";

function detectBundleFormat(
  value: JsonObject,
): DetectedBundleFormat {
  if (
    typeof value.mediaType === "string" &&
    value.mediaType.length > 0
  ) {
    return "sigstore-v0.3";
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
      "Legacy Cosign bundle detected. This adapter currently accepts Sigstore v0.3 serialized bundles only.",
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
      {
        certificateIssuer:
          policy.certificateIssuer,
        certificateIdentityURI:
          policy.certificateIdentityURI,
      },
    );
  } catch (error) {
    const message =
      failureMessage(error);

    markCryptographicFailure(
      report,
      message,
    );

    throw new SigstoreVerificationError(
      message,
      report,
    );
  }

  markCryptographicSuccess(
    report,
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
        "Signer identity verified.",
    },
  );

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
