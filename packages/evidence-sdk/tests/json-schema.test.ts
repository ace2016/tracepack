import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schema/tracepack-evidence.v1.json";
import { validateEvidencePayload } from "../src/validate";
import fixtureJson from "./fixtures/generic-analysis-tool.json";

const fixture = fixtureJson as Record<string, unknown>;

function clone(): typeof fixture {
  return JSON.parse(JSON.stringify(fixture));
}

// strict: true, but format keywords ("date-time", "uri") are left unvalidated — this repo
// has no ajv-formats dependency, and the schema's own `pattern` regexes already enforce the
// syntax those formats would check, so format is decorative documentation here, not a gap.
const ajv = new Ajv2020({ strict: true, formats: { "date-time": true, uri: true } });
const validateAgainstJsonSchema = ajv.compile(schema);

// The JSON Schema in schema/ is the language-agnostic contract a non-TypeScript producer
// builds against; src/validate.ts is its TypeScript mirror actually enforced at import time.
// These two must never silently drift apart — this file is what would catch that.
describe("tracepack-evidence.v1.json matches the zod validator it mirrors", () => {
  it("accepts the same valid fixture the zod validator accepts", () => {
    expect(validateEvidencePayload(fixture).ok).toBe(true);
    expect(validateAgainstJsonSchema(fixture)).toBe(true);
  });

  it("rejects unknown top-level fields, same as the zod validator", () => {
    const payload = { ...clone(), unexpected_field: "surprise" };
    expect(validateEvidencePayload(payload).ok).toBe(false);
    expect(validateAgainstJsonSchema(payload)).toBe(false);
  });

  it("rejects a malformed content_hash, same as the zod validator", () => {
    const payload = clone();
    (payload.attachments as Array<Record<string, unknown>>)[0]!.content_hash = "not-a-hash";
    expect(validateEvidencePayload(payload).ok).toBe(false);
    expect(validateAgainstJsonSchema(payload)).toBe(false);
  });

  it("rejects an unsupported attachment mime_type, same as the zod validator", () => {
    const payload = clone();
    (payload.attachments as Array<Record<string, unknown>>)[0]!.mime_type = "application/octet-stream";
    expect(validateEvidencePayload(payload).ok).toBe(false);
    expect(validateAgainstJsonSchema(payload)).toBe(false);
  });

  it("rejects a missing required field, same as the zod validator", () => {
    const payload = clone();
    delete payload.source;
    expect(validateEvidencePayload(payload).ok).toBe(false);
    expect(validateAgainstJsonSchema(payload)).toBe(false);
  });

  it("rejects schema_version other than the literal 1, same as the zod validator", () => {
    const payload = { ...clone(), schema_version: 2 };
    expect(validateEvidencePayload(payload).ok).toBe(false);
    expect(validateAgainstJsonSchema(payload)).toBe(false);
  });
});
