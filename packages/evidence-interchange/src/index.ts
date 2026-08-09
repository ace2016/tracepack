// The portable pieces of this contract (types, schema validation, RFC 8785 canonicalization)
// now live in @tracepack/evidence-sdk -- a separate, independently publishable package with no
// dependency on document-engine, storage, or anything browser-only, so an external producer can
// depend on just that instead of pulling in all of Tracepack. Re-exported here unchanged so
// nothing importing from @tracepack/evidence-interchange needs to change.
export {
  canonicalizeJson,
  computePayloadHash,
  isValidSha256Hex,
  sha256Hex,
  payloadSchema,
  validateEvidencePayload,
  SUPPORTED_ATTACHMENT_MIME_TYPES,
  SUPPORTED_SCHEMA_VERSIONS,
  type AttachmentV1,
  type ObservationV1,
  type SupportedAttachmentMimeType,
  type SupportedSchemaVersion,
  type TracepackEvidencePayloadV1,
  type ValidationIssue,
  type ValidationResult,
} from "@tracepack/evidence-sdk";
export { EvidenceInterchangeError, importEvidencePayload, type ImportEvidenceOptions, type ImportEvidenceResult } from "./import";
