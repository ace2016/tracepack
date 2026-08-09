import { describe, expect, it } from "vitest";
import { validateEvidencePayload } from "../src/validate";
import fixtureJson from "./fixtures/generic-analysis-tool.json";

const fixture = fixtureJson as Record<string, any>;

function clone(): typeof fixture { return JSON.parse(JSON.stringify(fixture)); }

describe("validateEvidencePayload", () => {
  it("accepts the generic third-party analysis tool fixture", () => {
    const result = validateEvidencePayload(fixture);
    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported schema_version before checking anything else", () => {
    const payload = { ...clone(), schema_version: 2 };
    const result = validateEvidencePayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.path).toBe("schema_version");
      expect(result.issues[0]?.message).toContain("Unsupported schema_version");
    }
  });

  it("rejects a missing schema_version the same way", () => {
    const payload = clone(); delete (payload as Record<string, unknown>).schema_version;
    const result = validateEvidencePayload(payload);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload that isn't an object", () => {
    expect(validateEvidencePayload("not an object").ok).toBe(false);
    expect(validateEvidencePayload(null).ok).toBe(false);
    expect(validateEvidencePayload([1, 2, 3]).ok).toBe(false);
  });

  it("rejects a malformed content_hash", () => {
    const payload = clone(); payload.attachments[0].content_hash = "not-a-hash";
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });

  it("rejects a malformed payload_hash", () => {
    const payload = clone(); payload.integrity.payload_hash = "too-short";
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });

  it("rejects an unsupported attachment mime_type", () => {
    const payload = clone(); payload.attachments[0].mime_type = "application/octet-stream";
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });

  it("rejects an unsupported encoding", () => {
    const payload = clone(); payload.attachments[0].encoding = "raw";
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });

  it("rejects a missing/empty attachment data field", () => {
    const payload = clone(); payload.attachments[0].data = "";
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });

  it("rejects duplicate attachment ids", () => {
    const payload = clone(); payload.attachments.push({ ...payload.attachments[0] });
    const result = validateEvidencePayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.message.includes("Duplicate attachment id"))).toBe(true);
  });

  it("rejects duplicate observation ids", () => {
    const payload = clone(); payload.observations.push({ ...payload.observations[0] });
    const result = validateEvidencePayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.message.includes("Duplicate observation id"))).toBe(true);
  });

  it("rejects an observation attachment_ref that doesn't match any attachment", () => {
    const payload = clone(); payload.observations[0].attachment_ref = "does-not-exist";
    const result = validateEvidencePayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.message.includes("does not match any attachment id"))).toBe(true);
  });

  it("rejects an invalid capture_timestamp", () => {
    const payload = clone(); payload.capture_timestamp = "not a date";
    expect(validateEvidencePayload(payload).ok).toBe(false);
    const payload2 = clone(); payload2.capture_timestamp = "2026-02-30T00:00:00Z"; // not a real calendar day
    expect(validateEvidencePayload(payload2).ok).toBe(false);
  });

  it("rejects an invalid source_url", () => {
    const payload = clone(); payload.source_url = "ftp://example.com/file";
    expect(validateEvidencePayload(payload).ok).toBe(false);
    const payload2 = clone(); payload2.source_url = "not a url";
    expect(validateEvidencePayload(payload2).ok).toBe(false);
  });

  it("rejects unknown top-level fields — the envelope is a closed shape", () => {
    const payload = { ...clone(), unexpected_field: "surprise" };
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });

  it("allows arbitrary keys inside metadata and observation data — the sanctioned open extension points", () => {
    const payload = clone();
    payload.metadata.anything_the_producer_wants = { nested: { deeply: true } };
    expect(validateEvidencePayload(payload).ok).toBe(true);
  });

  it("rejects __proto__/constructor/prototype keys inside metadata, at any depth", () => {
    const payload = clone();
    // Written as a JS object literal, `__proto__` sets the prototype (ECMA-262 Annex
    // B.3.1) rather than creating an own enumerable key, so it wouldn't exercise the
    // guard at all. The real threat model is untrusted JSON, where `__proto__` DOES
    // parse into a genuine own property — JSON.parse is what must be simulated here.
    payload.metadata = JSON.parse('{"safe":{"__proto__":{"polluted":true}}}');
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });

  it("rejects metadata larger than the 64KB limit", () => {
    const payload = clone();
    payload.metadata = { blob: "x".repeat(70_000) };
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });

  it("rejects a confidence value outside 0..1", () => {
    const payload = clone(); payload.observations[0].confidence = 1.5;
    expect(validateEvidencePayload(payload).ok).toBe(false);
  });
});
