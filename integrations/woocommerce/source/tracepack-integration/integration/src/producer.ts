import type { TracepackEvidencePayloadV1 } from "@tracepack/evidence-sdk";

import {
  TRACEPACK_HANDOFF_PROTOCOL_VERSION,
  type TracepackHandoffContext,
  type TracepackHandoffV1,
  type TracepackTemplateIntent,
} from "./protocol";

export interface CreateTracepackHandoffOptions {
  evidencePayload: TracepackEvidencePayloadV1;
  context?: TracepackHandoffContext;
  template?: TracepackTemplateIntent;
}

/**
 * Wraps an existing tracepack-evidence v1 payload in the handoff protocol.
 *
 * Producer identity is copied from the evidence payload rather than supplied
 * separately, preventing the handoff envelope and evidence provenance from
 * accidentally disagreeing.
 */
export function createTracepackHandoff(
  options: CreateTracepackHandoffOptions
): TracepackHandoffV1 {
  const { evidencePayload, context, template } = options;

  return {
    protocol_version: TRACEPACK_HANDOFF_PROTOCOL_VERSION,
    producer: {
      id: evidencePayload.source.producer_id,
      name: evidencePayload.source.producer_name,
      ...(evidencePayload.source.producer_version
        ? { version: evidencePayload.source.producer_version }
        : {}),
    },
    evidence_payload: evidencePayload,
    ...(context ? { context } : {}),
    ...(template ? { template } : {}),
  };
}
