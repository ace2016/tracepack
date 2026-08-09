// The tracepack-evidence wire format. See ../SPEC.md for the full design reasoning —
// this file is the TypeScript mirror of the JSON Schema in ../schema/tracepack-evidence.v1.json.
// Keep the two in sync; tests/json-schema.test.ts checks representative fixtures against both.

export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

/** Attachment MIME types Tracepack can actually preview, embed and export today. */
export const SUPPORTED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type SupportedAttachmentMimeType = (typeof SUPPORTED_ATTACHMENT_MIME_TYPES)[number];

export interface AttachmentV1 {
  id: string;
  filename: string;
  mime_type: SupportedAttachmentMimeType;
  /** Decoded byte length. Validated against the actual decoded size — see SPEC.md section 10. */
  size: number;
  /** sha256 hex of the original binary attachment bytes, before base64 encoding. See SPEC.md section 6.1. */
  content_hash: string;
  encoding: "base64";
  data: string;
}

export interface ObservationV1 {
  id: string;
  kind: string;
  label: string;
  detail: string;
  confidence?: number;
  /** If set, this observation is about that specific attachment. If absent, it is about the evidence as a whole. */
  attachment_ref?: string;
  data?: Record<string, unknown>;
}

export interface TracepackEvidencePayloadV1 {
  schema_version: 1;
  source: {
    producer_id: string;
    producer_name: string;
    producer_version?: string;
  };
  capture_timestamp: string;
  source_url?: string;
  evidence_type: string;
  attachments: AttachmentV1[];
  observations: ObservationV1[];
  metadata?: Record<string, unknown>;
  integrity: {
    algorithm: "sha256";
    canonicalization: "RFC8785";
    payload_hash: string;
  };
}

/** Any schema_version, used only to read the version field before full validation. */
export interface UnknownVersionedPayload {
  schema_version?: unknown;
}
