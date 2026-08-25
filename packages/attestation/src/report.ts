import type {
  AttestationVerificationReportV1,
  AttestationVerificationStageId,
  AttestationVerificationStageStatus,
  AttestationVerificationStageV1,
} from "./types";

export const VERIFICATION_STAGE_ORDER:
  AttestationVerificationStageId[] = [
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
  ];

export function createVerificationReport():
  AttestationVerificationReportV1 {
  return {
    stages: VERIFICATION_STAGE_ORDER.map(
      (id) => ({
        id,
        status: "pending",
      }),
    ),
  };
}

export function setVerificationStage(
  report: AttestationVerificationReportV1,
  id: AttestationVerificationStageId,
  status: AttestationVerificationStageStatus,
  options: {
    code?: string;
    message?: string;
  } = {},
): void {
  const stage = report.stages.find(
    (candidate) => candidate.id === id,
  );

  if (!stage) {
    throw new Error(
      `Unknown verification stage: ${id}`,
    );
  }

  stage.status = status;

  if (options.code !== undefined) {
    stage.code = options.code;
  }

  if (options.message !== undefined) {
    stage.message = options.message;
  }
}

export function verificationStage(
  report: AttestationVerificationReportV1,
  id: AttestationVerificationStageId,
): AttestationVerificationStageV1 {
  const stage = report.stages.find(
    (candidate) => candidate.id === id,
  );

  if (!stage) {
    throw new Error(
      `Unknown verification stage: ${id}`,
    );
  }

  return stage;
}
