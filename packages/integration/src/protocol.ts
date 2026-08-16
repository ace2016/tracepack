import type { TracepackEvidencePayloadV1 } from "@tracepack/evidence-sdk";

export const TRACEPACK_HANDOFF_PROTOCOL_VERSION = 1 as const;

export type TracepackHandoffProtocolVersion =
  typeof TRACEPACK_HANDOFF_PROTOCOL_VERSION;

export interface TracepackProducerDescriptor {
  id: string;
  name: string;
  version?: string;
}

export interface TracepackHandoffContext {
  purpose?: string;
  problem_type?: string;
  reference?: string;
}

export type TracepackTemplateMode =
  | "recommend"
  | "suggest"
  | "supply"
  | "none";

export interface TracepackTemplateIntent {
  mode: TracepackTemplateMode;
  template_id?: string;
  template?: unknown;
}

export interface TracepackHandoffV1 {
  protocol_version: 1;
  producer: TracepackProducerDescriptor;
  evidence_payload: TracepackEvidencePayloadV1;
  context?: TracepackHandoffContext;
  template?: TracepackTemplateIntent;
}

export interface TracepackReadyMessage {
  source: "tracepack";
  type: "ready";
  protocol_version: 1;
}

export interface TracepackSendMessage {
  source: "tracepack-producer";
  type: "send";
  protocol_version: 1;
  handoff_id: string;
  handoff: TracepackHandoffV1;
}

export interface TracepackAcceptedMessage {
  source: "tracepack";
  type: "accepted";
  protocol_version: 1;
  handoff_id: string;
}

export interface TracepackImportedMessage {
  source: "tracepack";
  type: "imported";
  protocol_version: 1;
  handoff_id: string;
  project_id: string;
  evidence_count: number;
}

export type TracepackHandoffErrorCode =
  | "INVALID_MESSAGE"
  | "UNSUPPORTED_PROTOCOL"
  | "INVALID_HANDOFF"
  | "INVALID_EVIDENCE"
  | "PAYLOAD_TOO_LARGE"
  | "TIMED_OUT"
  | "DUPLICATE_HANDOFF"
  | "IMPORT_FAILED";

export interface TracepackHandoffIssue {
  code: TracepackHandoffErrorCode;
  message: string;
  path?: string;
}

export interface TracepackRejectedMessage {
  source: "tracepack";
  type: "rejected";
  protocol_version: 1;
  handoff_id: string;
  issues: TracepackHandoffIssue[];
}

export interface TracepackCancelledMessage {
  source: "tracepack";
  type: "cancelled";
  protocol_version: 1;
  handoff_id: string;
}

export type TracepackProducerMessage =
  | TracepackSendMessage;

export type TracepackWorkspaceMessage =
  | TracepackReadyMessage
  | TracepackAcceptedMessage
  | TracepackRejectedMessage
  | TracepackCancelledMessage
  | TracepackImportedMessage;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTracepackReadyMessage(
  value: unknown
): value is TracepackReadyMessage {
  return (
    isRecord(value) &&
    value.source === "tracepack" &&
    value.type === "ready" &&
    value.protocol_version === TRACEPACK_HANDOFF_PROTOCOL_VERSION
  );
}

export function isTracepackSendMessage(
  value: unknown
): value is TracepackSendMessage {
  return (
    isRecord(value) &&
    value.source === "tracepack-producer" &&
    value.type === "send" &&
    value.protocol_version === TRACEPACK_HANDOFF_PROTOCOL_VERSION &&
    typeof value.handoff_id === "string" &&
    value.handoff_id.length > 0 &&
    isRecord(value.handoff)
  );
}

export function isTracepackAcceptedMessage(
  value: unknown
): value is TracepackAcceptedMessage {
  return (
    isRecord(value) &&
    value.source === "tracepack" &&
    value.type === "accepted" &&
    value.protocol_version === TRACEPACK_HANDOFF_PROTOCOL_VERSION &&
    typeof value.handoff_id === "string" &&
    value.handoff_id.length > 0
  );
}

export function isTracepackRejectedMessage(
  value: unknown
): value is TracepackRejectedMessage {
  return (
    isRecord(value) &&
    value.source === "tracepack" &&
    value.type === "rejected" &&
    value.protocol_version === TRACEPACK_HANDOFF_PROTOCOL_VERSION &&
    typeof value.handoff_id === "string" &&
    value.handoff_id.length > 0 &&
    Array.isArray(value.issues)
  );
}

export function isTracepackImportedMessage(
  value: unknown
): value is TracepackImportedMessage {
  return (
    isRecord(value) &&
    value.source === "tracepack" &&
    value.type === "imported" &&
    value.protocol_version === TRACEPACK_HANDOFF_PROTOCOL_VERSION &&
    typeof value.handoff_id === "string" &&
    value.handoff_id.length > 0 &&
    typeof value.project_id === "string" &&
    typeof value.evidence_count === "number"
  );
}

export function createTracepackReadyMessage(): TracepackReadyMessage {
  return {
    source: "tracepack",
    type: "ready",
    protocol_version: TRACEPACK_HANDOFF_PROTOCOL_VERSION,
  };
}

export function createTracepackAcceptedMessage(
  handoffId: string
): TracepackAcceptedMessage {
  return {
    source: "tracepack",
    type: "accepted",
    protocol_version: TRACEPACK_HANDOFF_PROTOCOL_VERSION,
    handoff_id: handoffId,
  };
}

export function createTracepackRejectedMessage(
  handoffId: string,
  issues: TracepackHandoffIssue[]
): TracepackRejectedMessage {
  return {
    source: "tracepack",
    type: "rejected",
    protocol_version: TRACEPACK_HANDOFF_PROTOCOL_VERSION,
    handoff_id: handoffId,
    issues,
  };
}

export function createTracepackImportedMessage(
  handoffId: string,
  projectId: string,
  evidenceCount: number
): TracepackImportedMessage {
  return {
    source: "tracepack",
    type: "imported",
    protocol_version: TRACEPACK_HANDOFF_PROTOCOL_VERSION,
    handoff_id: handoffId,
    project_id: projectId,
    evidence_count: evidenceCount,
  };
}

export function createTracepackCancelledMessage(
  handoffId: string
): TracepackCancelledMessage {
  return {
    source: "tracepack",
    type: "cancelled",
    protocol_version: TRACEPACK_HANDOFF_PROTOCOL_VERSION,
    handoff_id: handoffId,
  };
}

export function createTracepackSendMessage(
  handoffId: string,
  handoff: TracepackHandoffV1
): TracepackSendMessage {
  return {
    source: "tracepack-producer",
    type: "send",
    protocol_version: TRACEPACK_HANDOFF_PROTOCOL_VERSION,
    handoff_id: handoffId,
    handoff,
  };
}

export function isTracepackCancelledMessage(
  value: unknown
): value is TracepackCancelledMessage {
  return (
    isRecord(value) &&
    value.source === "tracepack" &&
    value.type === "cancelled" &&
    value.protocol_version === TRACEPACK_HANDOFF_PROTOCOL_VERSION &&
    typeof value.handoff_id === "string" &&
    value.handoff_id.length > 0
  );
}
