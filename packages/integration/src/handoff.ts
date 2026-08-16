import {
  validateEvidencePayload,
  type TracepackEvidencePayloadV1,
} from "@tracepack/evidence-sdk";

import {
  TRACEPACK_HANDOFF_PROTOCOL_VERSION,
  isRecord,
  type TracepackHandoffErrorCode,
  type TracepackHandoffV1,
} from "./protocol";

export interface TracepackHandoffValidationIssue {
  code: TracepackHandoffErrorCode;
  path: string;
  message: string;
}

export type TracepackHandoffValidationResult =
  | { ok: true; handoff: TracepackHandoffV1 }
  | { ok: false; issues: TracepackHandoffValidationIssue[] };

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function addIssue(
  issues: TracepackHandoffValidationIssue[],
  code: TracepackHandoffErrorCode,
  path: string,
  message: string
) {
  issues.push({ code, path, message });
}

function validateContext(
  value: unknown,
  issues: TracepackHandoffValidationIssue[]
) {
  if (value === undefined) return;

  if (!isRecord(value)) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "context",
      "context must be an object."
    );
    return;
  }

  for (const key of ["purpose", "problem_type", "reference"] as const) {
    if (value[key] !== undefined && !nonEmptyString(value[key])) {
      addIssue(
        issues,
        "INVALID_HANDOFF",
        `context.${key}`,
        `${key} must be a non-empty string when provided.`
      );
    }
  }
}

function validateTemplateIntent(
  value: unknown,
  issues: TracepackHandoffValidationIssue[]
) {
  if (value === undefined) return;

  if (!isRecord(value)) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "template",
      "template must be an object."
    );
    return;
  }

  const modes = ["recommend", "suggest", "supply", "none"] as const;

  if (!modes.includes(value.mode as (typeof modes)[number])) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "template.mode",
      "template.mode must be recommend, suggest, supply, or none."
    );
    return;
  }

  if (value.mode === "suggest" && !nonEmptyString(value.template_id)) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "template.template_id",
      "template_id is required when template.mode is suggest."
    );
  }

  if (value.mode === "supply" && !("template" in value)) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "template.template",
      "template is required when template.mode is supply."
    );
  }
}

function checkProducerConsistency(
  producer: Record<string, unknown>,
  payload: TracepackEvidencePayloadV1,
  issues: TracepackHandoffValidationIssue[]
) {
  if (
    nonEmptyString(producer.id) &&
    producer.id !== payload.source.producer_id
  ) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "producer.id",
      "Handoff producer id must match evidence_payload.source.producer_id."
    );
  }

  if (
    nonEmptyString(producer.name) &&
    producer.name !== payload.source.producer_name
  ) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "producer.name",
      "Handoff producer name must match evidence_payload.source.producer_name."
    );
  }

  if (
    nonEmptyString(producer.version) &&
    payload.source.producer_version !== undefined &&
    producer.version !== payload.source.producer_version
  ) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "producer.version",
      "Handoff producer version must match evidence_payload.source.producer_version."
    );
  }
}

export function validateTracepackHandoff(
  input: unknown
): TracepackHandoffValidationResult {
  const issues: TracepackHandoffValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        {
          code: "INVALID_HANDOFF",
          path: "",
          message: "Handoff must be a JSON object.",
        },
      ],
    };
  }

  if (input.protocol_version !== TRACEPACK_HANDOFF_PROTOCOL_VERSION) {
    addIssue(
      issues,
      "UNSUPPORTED_PROTOCOL",
      "protocol_version",
      `Unsupported handoff protocol version ${JSON.stringify(input.protocol_version)}.`
    );
  }

  if (!isRecord(input.producer)) {
    addIssue(
      issues,
      "INVALID_HANDOFF",
      "producer",
      "producer must be an object."
    );
  } else {
    if (!nonEmptyString(input.producer.id)) {
      addIssue(
        issues,
        "INVALID_HANDOFF",
        "producer.id",
        "producer.id must be a non-empty string."
      );
    }

    if (!nonEmptyString(input.producer.name)) {
      addIssue(
        issues,
        "INVALID_HANDOFF",
        "producer.name",
        "producer.name must be a non-empty string."
      );
    }

    if (
      input.producer.version !== undefined &&
      !nonEmptyString(input.producer.version)
    ) {
      addIssue(
        issues,
        "INVALID_HANDOFF",
        "producer.version",
        "producer.version must be a non-empty string when provided."
      );
    }
  }

  validateContext(input.context, issues);
  validateTemplateIntent(input.template, issues);

  const evidenceResult = validateEvidencePayload(input.evidence_payload);

  if (!evidenceResult.ok) {
    for (const issue of evidenceResult.issues) {
      addIssue(
        issues,
        "INVALID_EVIDENCE",
        issue.path
          ? `evidence_payload.${issue.path}`
          : "evidence_payload",
        issue.message
      );
    }
  } else if (isRecord(input.producer)) {
    checkProducerConsistency(
      input.producer,
      evidenceResult.payload,
      issues
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    handoff: input as unknown as TracepackHandoffV1,
  };
}
