import { z } from "zod";
import { isValidSha256Hex } from "./canonicalize";
import { SUPPORTED_ATTACHMENT_MIME_TYPES, SUPPORTED_SCHEMA_VERSIONS, type TracepackEvidencePayloadV1 } from "./types";

const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Date.parse/the Date constructor silently "roll over" invalid calendar dates (e.g. Feb 30
// becomes Mar 2) instead of rejecting them, so validity can't be decided by parse success
// alone. Constructing from UTC components and checking they round-trip exactly catches this.
function isValidIsoTimestamp(value: string): boolean {
  const match = ISO_8601.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Producer-defined free-form data must stay small and can't smuggle prototype-pollution keys. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_OPEN_DATA_BYTES = 64 * 1024;

function findUnsafeKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) { const found = findUnsafeKey(entry); if (found) return found; }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (UNSAFE_KEYS.has(key)) return key;
      const found = findUnsafeKey((value as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  return undefined;
}

function checkOpenData(value: Record<string, unknown> | undefined, path: (string | number)[], ctx: z.RefinementCtx) {
  if (value === undefined) return;
  const unsafeKey = findUnsafeKey(value);
  if (unsafeKey) ctx.addIssue({ code: "custom", path, message: `Unsafe key "${unsafeKey}" is not allowed in producer-defined data.` });
  const size = new TextEncoder().encode(JSON.stringify(value)).length;
  if (size > MAX_OPEN_DATA_BYTES) ctx.addIssue({ code: "custom", path, message: `Producer-defined data is ${size} bytes, exceeding the ${MAX_OPEN_DATA_BYTES} byte limit.` });
}

const sha256HexSchema = z.string().refine(isValidSha256Hex, { message: "Must be a 64 character lowercase sha256 hex digest." });

const attachmentSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  mime_type: z.enum(SUPPORTED_ATTACHMENT_MIME_TYPES),
  size: z.number().int().nonnegative(),
  content_hash: sha256HexSchema,
  encoding: z.literal("base64"),
  data: z.string().min(1),
}).strict();

const observationSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  attachment_ref: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict();

const payloadSchemaBase = z.object({
  schema_version: z.literal(1),
  source: z.object({
    producer_id: z.string().min(1),
    producer_name: z.string().min(1),
    producer_version: z.string().min(1).optional(),
  }).strict(),
  capture_timestamp: z.string().refine(isValidIsoTimestamp, { message: "Must be a valid ISO 8601 timestamp, e.g. 2026-08-06T09:00:00Z." }),
  source_url: z.string().refine(isAbsoluteHttpUrl, { message: "Must be an absolute http(s) URL." }).optional(),
  evidence_type: z.string().min(1),
  attachments: z.array(attachmentSchema),
  observations: z.array(observationSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    canonicalization: z.literal("RFC8785"),
    payload_hash: sha256HexSchema,
  }).strict(),
}).strict();

export const payloadSchema = payloadSchemaBase.superRefine((payload, ctx) => {
  const attachmentIds = new Set<string>();
  payload.attachments.forEach((attachment, index) => {
    if (attachmentIds.has(attachment.id)) ctx.addIssue({ code: "custom", path: ["attachments", index, "id"], message: `Duplicate attachment id "${attachment.id}".` });
    attachmentIds.add(attachment.id);
  });

  const observationIds = new Set<string>();
  payload.observations.forEach((observation, index) => {
    if (observationIds.has(observation.id)) ctx.addIssue({ code: "custom", path: ["observations", index, "id"], message: `Duplicate observation id "${observation.id}".` });
    observationIds.add(observation.id);
    if (observation.attachment_ref && !attachmentIds.has(observation.attachment_ref)) {
      ctx.addIssue({ code: "custom", path: ["observations", index, "attachment_ref"], message: `attachment_ref "${observation.attachment_ref}" does not match any attachment id in this payload.` });
    }
    checkOpenData(observation.data, ["observations", index, "data"], ctx);
  });

  checkOpenData(payload.metadata, ["metadata"], ctx);
});

export interface ValidationIssue { path: string; message: string }
export type ValidationResult =
  | { ok: true; payload: TracepackEvidencePayloadV1 }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Structural + semantic validation only — does NOT verify attachment byte hashes or the
 * payload integrity hash (those require decoding attachment data and hashing, done in
 * import.ts once we know the payload is at least structurally sound). Version is checked
 * first, and separately, so an unsupported version gets a version-specific message instead
 * of a wall of "unrecognised schema_version" shape errors.
 */
export function validateEvidencePayload(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) return { ok: false, issues: [{ path: "", message: "Payload must be a JSON object." }] };
  const version = (input as { schema_version?: unknown }).schema_version;
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(version as never)) {
    return { ok: false, issues: [{ path: "schema_version", message: `Unsupported schema_version ${JSON.stringify(version)}. This importer supports: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}.` }] };
  }

  const result = payloadSchema.safeParse(input);
  if (result.success) return { ok: true, payload: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  };
}
