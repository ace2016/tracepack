import { describe, expect, it } from "vitest";
import { checkEvidenceJson, checkManifestDiff, checkTemplateYaml } from "../src/commands";
import type { ManifestEvidenceEntry, TracepackManifest } from "@tracepack/evidence-core";

describe("checkTemplateYaml", () => {
  it("accepts a real, valid template and reports its name and category count", () => {
    const result = checkTemplateYaml(`
id: example
name: Example template
version: 1.0.0
jurisdiction: general
categories:
  - id: docs
    name: Documents
    requirement: required
    description: Any relevant documents.
    accepted_types: [pdf, image]
export_sections: [cover, evidence_index]
`);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Example template");
    expect(result.message).toContain("1 category");
  });

  it("rejects a template missing a required field, with a path pointing at what's wrong", () => {
    const result = checkTemplateYaml(`
id: example
name: Example template
version: 1.0.0
jurisdiction: general
categories: []
export_sections: [cover]
`);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("categories");
  });

  it("rejects a template with a malformed privacy_rules regex pattern at load time", () => {
    const result = checkTemplateYaml(`
id: example
name: Example template
version: 1.0.0
jurisdiction: general
privacy_rules:
  - kind: broken
    label: Broken rule
    pattern: '(unclosed'
categories:
  - id: docs
    name: Documents
    requirement: required
    description: ""
    accepted_types: [pdf]
export_sections: [cover]
`);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("regular expression");
  });

  it("rejects a privacy_rules entry whose pattern is valid alone but whose flags make it invalid", () => {
    // Regression: pattern and flags used to be validated separately, so a rule like this
    // passed template-load validation, then was silently dropped later at scan time by
    // document-engine's compileTemplateRules -- meaning the PII detection it promised never
    // actually ran, with nothing here to warn a template author.
    const result = checkTemplateYaml(`
id: example
name: Example template
version: 1.0.0
jurisdiction: general
privacy_rules:
  - kind: broken
    label: Broken rule
    pattern: '[a-z]+'
    flags: 'x'
categories:
  - id: docs
    name: Documents
    requirement: required
    description: ""
    accepted_types: [pdf]
export_sections: [cover]
`);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("pattern and flags together");
  });

  it("rejects text that isn't valid YAML at all, without throwing past the caller", () => {
    const result = checkTemplateYaml("not: valid: yaml: at: all: [");
    expect(result.ok).toBe(false);
  });
});

describe("checkEvidenceJson", () => {
  const validPayload = {
    schema_version: 1,
    source: { producer_id: "org.example.tool", producer_name: "Example Tool" },
    capture_timestamp: "2026-01-01T00:00:00Z",
    evidence_type: "product_listing_review",
    attachments: [],
    observations: [
      { id: "obs-1", kind: "example", label: "An example observation", detail: "Some detail." },
    ],
    integrity: {
      algorithm: "sha256",
      canonicalization: "RFC8785",
      payload_hash: "a".repeat(64),
    },
  };

  it("accepts a structurally valid payload and reports producer/attachment/observation counts", () => {
    const result = checkEvidenceJson(JSON.stringify(validPayload));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Example Tool");
    expect(result.message).toContain("0 attachments");
    expect(result.message).toContain("1 observation");
  });

  it("does not verify the payload_hash is actually correct — that requires the real import step", () => {
    // payload_hash above is deliberately not the real RFC 8785 hash of this payload; structural
    // validation alone still passes, matching validateEvidencePayload's documented scope.
    const result = checkEvidenceJson(JSON.stringify(validPayload));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("does not verify");
  });

  it("rejects a payload with an unsupported schema_version before checking anything else", () => {
    const result = checkEvidenceJson(JSON.stringify({ ...validPayload, schema_version: 2 }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("schema_version");
  });

  it("rejects malformed JSON with a clear parse error, not a crash", () => {
    const result = checkEvidenceJson("{ not valid json");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid JSON");
  });

  it("rejects a payload missing a required field", () => {
    const { source: _source, ...withoutSource } = validPayload;
    const result = checkEvidenceJson(JSON.stringify(withoutSource));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("source");
  });
});

describe("checkManifestDiff", () => {
  function entry(overrides: Partial<ManifestEvidenceEntry> = {}): ManifestEvidenceEntry {
    return {
      id: "e1", title: "Receipt", categoryId: "proof_of_purchase", sourceType: "pdf",
      originalFileName: "receipt.pdf", sourceUrl: null, importedAt: "2026-01-01T00:00:00.000Z",
      eventDate: null, contentHash: "a".repeat(64), reviewStatus: "reviewed", ...overrides,
    };
  }
  function manifestJson(evidence: ManifestEvidenceEntry[]): string {
    const manifest: TracepackManifest = {
      format: "tracepack-source-manifest", version: 1, exportedAt: "2026-01-02T00:00:00.000Z",
      project: { id: "p1", title: "A dispute", templateId: "consumer-complaint", templateVersion: "1" },
      evidence,
    };
    return JSON.stringify(manifest);
  }

  it("succeeds with no differences reported for two identical manifests", () => {
    const json = manifestJson([entry()]);
    const result = checkManifestDiff(json, json);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("1 item(s) unchanged");
  });

  it("reports an added item and still succeeds (additions are not a failure)", () => {
    const before = manifestJson([entry({ id: "e1" })]);
    const after = manifestJson([entry({ id: "e1" }), entry({ id: "e2", title: "New receipt" })]);
    const result = checkManifestDiff(before, after);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Added (1)");
    expect(result.message).toContain('e2 ("New receipt")');
  });

  it("reports a metadata-only change and still succeeds", () => {
    const before = manifestJson([entry({ title: "Old title" })]);
    const after = manifestJson([entry({ title: "New title" })]);
    const result = checkManifestDiff(before, after);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Metadata changed (1)");
    expect(result.message).toContain("title");
  });

  it("fails when a contentHash changes under the same id, and flags it as an anomaly", () => {
    const before = manifestJson([entry({ contentHash: "a".repeat(64) })]);
    const after = manifestJson([entry({ contentHash: "b".repeat(64) })]);
    const result = checkManifestDiff(before, after);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ANOMALY");
    expect(result.message).toContain(`${"a".repeat(64)} -> ${"b".repeat(64)}`);
  });

  it("rejects malformed JSON in either file with a clear message, not a crash", () => {
    const valid = manifestJson([entry()]);
    expect(checkManifestDiff("{ not json", valid).ok).toBe(false);
    expect(checkManifestDiff("{ not json", valid).message).toContain("Invalid JSON");
    expect(checkManifestDiff(valid, "{ not json").ok).toBe(false);
    expect(checkManifestDiff(valid, "{ not json").message).toContain('"after"');
  });

  it("rejects a JSON file that isn't shaped like a Tracepack manifest", () => {
    const valid = manifestJson([entry()]);
    const result = checkManifestDiff(JSON.stringify({ hello: "world" }), valid);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("does not look like a Tracepack manifest");
  });
});
