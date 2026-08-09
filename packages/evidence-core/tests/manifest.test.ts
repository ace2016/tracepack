import { describe, expect, it } from "vitest";
import { diffManifests, looksLikeTracepackManifest, type ManifestEvidenceEntry, type TracepackManifest } from "../src/manifest";

function entry(overrides: Partial<ManifestEvidenceEntry> = {}): ManifestEvidenceEntry {
  return {
    id: "e1",
    title: "Receipt",
    categoryId: "proof_of_purchase",
    sourceType: "pdf",
    originalFileName: "receipt.pdf",
    sourceUrl: null,
    importedAt: "2026-01-01T00:00:00.000Z",
    eventDate: null,
    contentHash: "a".repeat(64),
    reviewStatus: "reviewed",
    ...overrides,
  };
}

function manifest(evidence: ManifestEvidenceEntry[], projectId = "p1"): TracepackManifest {
  return {
    format: "tracepack-source-manifest",
    version: 1,
    exportedAt: "2026-01-02T00:00:00.000Z",
    project: { id: projectId, title: "A dispute", templateId: "consumer-complaint", templateVersion: "1" },
    evidence,
  };
}

describe("diffManifests", () => {
  it("reports no changes for two identical manifests", () => {
    const m = manifest([entry()]);
    const diff = diffManifests(m, m);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.contentChanged).toEqual([]);
    expect(diff.metadataChanged).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("detects an added item", () => {
    const before = manifest([entry({ id: "e1" })]);
    const after = manifest([entry({ id: "e1" }), entry({ id: "e2", title: "New receipt" })]);
    const diff = diffManifests(before, after);
    expect(diff.added.map((e) => e.id)).toEqual(["e2"]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("detects a removed item", () => {
    const before = manifest([entry({ id: "e1" }), entry({ id: "e2" })]);
    const after = manifest([entry({ id: "e1" })]);
    const diff = diffManifests(before, after);
    expect(diff.removed.map((e) => e.id)).toEqual(["e2"]);
    expect(diff.added).toEqual([]);
  });

  it("classifies a contentHash change as contentChanged, not metadataChanged, even if other fields also differ", () => {
    const before = manifest([entry({ id: "e1", contentHash: "a".repeat(64), title: "Old title" })]);
    const after = manifest([entry({ id: "e1", contentHash: "b".repeat(64), title: "New title" })]);
    const diff = diffManifests(before, after);
    expect(diff.contentChanged).toHaveLength(1);
    expect(diff.contentChanged[0]?.id).toBe("e1");
    expect(diff.contentChanged[0]?.before.contentHash).toBe("a".repeat(64));
    expect(diff.contentChanged[0]?.after.contentHash).toBe("b".repeat(64));
    // Not double-counted as a metadata change too.
    expect(diff.metadataChanged).toEqual([]);
  });

  it("detects a metadata-only change (same contentHash) and names exactly the fields that changed", () => {
    const before = manifest([entry({ id: "e1", title: "Old title", reviewStatus: "needs_review" })]);
    const after = manifest([entry({ id: "e1", title: "New title", reviewStatus: "reviewed" })]);
    const diff = diffManifests(before, after);
    expect(diff.contentChanged).toEqual([]);
    expect(diff.metadataChanged).toHaveLength(1);
    expect(diff.metadataChanged[0]?.changedFields.sort()).toEqual(["reviewStatus", "title"]);
  });

  it("does not flag importedAt, provenance, or observations differences as metadata changes", () => {
    const before = manifest([entry({ id: "e1", importedAt: "2026-01-01T00:00:00.000Z", observations: [{ id: "o1" }] })]);
    const after = manifest([entry({ id: "e1", importedAt: "2026-01-05T00:00:00.000Z", observations: [{ id: "o1", extra: true }] })]);
    const diff = diffManifests(before, after);
    expect(diff.metadataChanged).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("handles two manifests with completely disjoint evidence", () => {
    const before = manifest([entry({ id: "e1" })]);
    const after = manifest([entry({ id: "e2" })]);
    const diff = diffManifests(before, after);
    expect(diff.added.map((e) => e.id)).toEqual(["e2"]);
    expect(diff.removed.map((e) => e.id)).toEqual(["e1"]);
    expect(diff.unchangedCount).toBe(0);
  });

  it("carries the before/after project ids through, even when they differ", () => {
    const before = manifest([entry()], "p1");
    const after = manifest([entry()], "p2");
    const diff = diffManifests(before, after);
    expect(diff.beforeProjectId).toBe("p1");
    expect(diff.afterProjectId).toBe("p2");
  });
});

describe("looksLikeTracepackManifest", () => {
  it("accepts a real manifest shape", () => {
    expect(looksLikeTracepackManifest(manifest([entry()]))).toBe(true);
  });

  it("rejects an unrelated JSON object", () => {
    expect(looksLikeTracepackManifest({ hello: "world" })).toBe(false);
  });

  it("rejects null, arrays, and primitives", () => {
    expect(looksLikeTracepackManifest(null)).toBe(false);
    expect(looksLikeTracepackManifest([])).toBe(false);
    expect(looksLikeTracepackManifest("a manifest")).toBe(false);
  });

  it("rejects an object with the right format string but a missing evidence array", () => {
    expect(looksLikeTracepackManifest({ format: "tracepack-source-manifest", version: 1, project: {} })).toBe(false);
  });
});
