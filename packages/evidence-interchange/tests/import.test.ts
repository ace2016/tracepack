import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type TemplateSnapshot, type TracepackProject } from "@tracepack/evidence-core";
import fixtureJson from "./fixtures/generic-analysis-tool.json";

const saveProjectAndFiles = vi.fn().mockResolvedValue(undefined);
vi.mock("@tracepack/storage", () => ({ saveProjectAndFiles: (...args: unknown[]) => saveProjectAndFiles(...args) }));

// Only needed for the mixed-attachment-type tests below, which need a real "pdf" mime
// attachment alongside an image one. Same mocking approach as tests/pdf-pii-scan.test.ts
// (see that file's comment for why inspectPdf itself isn't run for real here) -- resolved to
// a trivial empty result so those tests aren't exercising PDF text extraction, only category
// resolution.
const inspectPdf = vi.fn().mockResolvedValue({ pageCount: 1, text: "", findings: [], textStatus: "no_text_layer" });
vi.mock("@tracepack/document-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepack/document-engine")>();
  return { ...actual, inspectPdf: (...args: unknown[]) => inspectPdf(...args) };
});

const { importEvidencePayload, EvidenceInterchangeError } = await import("../src/import");
const { computePayloadHash, sha256Hex } = await import("@tracepack/evidence-sdk");

const fixture = fixtureJson as any;
function clone(): typeof fixture { return JSON.parse(JSON.stringify(fixture)); }

const template: TemplateSnapshot = {
  id: "test-template", name: "Test", version: "1.0.0", jurisdiction: "general", exportSections: [],
  categories: [
    { id: "product_information", name: "Product information", description: "", requirement: "recommended", acceptedTypes: ["pdf", "image", "webpage", "note"] },
    { id: "complaint_details", name: "Complaint details", description: "", requirement: "required", acceptedTypes: ["note"] },
  ],
};

function baseProject(): TracepackProject {
  return createProject({ title: "Test case", organisation: "", summary: "", desiredResolution: "", template });
}

describe("importEvidencePayload", () => {
  beforeEach(() => { saveProjectAndFiles.mockClear(); });

  it("imports the generic third-party fixture into a real EvidenceItem with provenance and observations intact", async () => {
    const result = await importEvidencePayload(fixture, { project: baseProject(), categoryId: "product_information" });

    expect(result.createdEvidenceIds).toHaveLength(1);
    const item = result.project.evidence[0]!;

    expect(item.sourceType).toBe("image");
    expect(item.categoryId).toBe("product_information");
    expect(item.contentHash).toBe(fixture.attachments[0].content_hash);
    expect(item.mimeType).toBe("image/png");

    // Provenance must name the actual producer, not Tracepack.
    expect(item.provenance).toEqual({
      producerId: "com.example.review-pattern-analyzer",
      producerName: "Example Review Pattern Analyzer",
      producerVersion: "2.3.0",
      schemaVersion: 1,
      capturedAt: "2026-08-04T09:15:00Z",
      sourceUrl: "https://kitchenexample.com/product/kt-4400",
    });

    // Both observations land on the single derived item (only one attachment exists).
    expect(item.observations).toHaveLength(2);
    expect(item.observations?.[0]?.kind).toBe("suspicious_review_clustering");
    expect(item.observations?.[0]?.confidence).toBe(0.82);

    // An imported observation must never be indistinguishable from Tracepack's own findings.
    expect(item.privacyFindings ?? []).toHaveLength(0);

    // The project and every attachment blob are persisted together, once, atomically —
    // never as separate per-file calls the caller could observe partially completing.
    expect(saveProjectAndFiles).toHaveBeenCalledTimes(1);
    const [savedProject, savedFiles] = saveProjectAndFiles.mock.calls[0]!;
    expect(savedProject).toBe(result.project);
    expect(savedFiles).toBeInstanceOf(Map);
    expect(savedFiles.get(item.id)).toBeInstanceOf(Blob);
  });

  it("routes attachment-scoped observations to their attachment and envelope-wide observations to every item", async () => {
    const payload = clone();
    // Add a second attachment so attachment_ref routing is actually exercised.
    const secondAttachmentBytes = new TextEncoder().encode("second attachment bytes");
    const secondHash = await sha256Hex(secondAttachmentBytes);
    payload.attachments.push({
      id: "att-2", filename: "second.png", mime_type: "image/png",
      size: secondAttachmentBytes.length, content_hash: secondHash, encoding: "base64",
      data: btoa(String.fromCharCode(...secondAttachmentBytes)),
    });
    // obs-1 already has attachment_ref: "att-1". obs-2 has no attachment_ref (envelope-wide).
    payload.integrity.payload_hash = await computePayloadHash(payload);

    const result = await importEvidencePayload(payload, { project: baseProject(), categoryId: "product_information" });
    expect(result.createdEvidenceIds).toHaveLength(2);

    const [itemForAtt1, itemForAtt2] = result.project.evidence;
    expect(itemForAtt1?.observations?.map((o) => o.id)).toEqual(["obs-1", "obs-2"]);
    expect(itemForAtt2?.observations?.map((o) => o.id)).toEqual(["obs-2"]);
  });

  it("creates a single note-type item for an attachment-less payload, still carrying provenance and observations", async () => {
    const payload = clone();
    payload.attachments = [];
    payload.observations = payload.observations.map(({ attachment_ref: _ref, ...rest }: { attachment_ref?: string }) => rest);
    payload.integrity.payload_hash = await computePayloadHash(payload);

    const result = await importEvidencePayload(payload, { project: baseProject(), categoryId: "complaint_details" });
    expect(result.createdEvidenceIds).toHaveLength(1);
    const item = result.project.evidence[0]!;
    expect(item.sourceType).toBe("note");
    expect(item.mimeType).toBe("text/plain");
    expect(item.observations).toHaveLength(2);
    expect(item.extractedText).toContain("Suspicious review timing pattern");
    expect(item.provenance?.producerName).toBe("Example Review Pattern Analyzer");

    // The synthesized blob must be unmistakable as a Tracepack-generated rendering of
    // reported claims, never mistakable for an original document the producer supplied —
    // this is the whole reason it exists to satisfy the one-item-one-blob model, not because
    // it's evidential content in its own right.
    expect(item.extractedText).toContain("GENERATED BY TRACEPACK");
    expect(item.extractedText).toContain("not an original document");
    expect(item.extractedText).toContain("Example Review Pattern Analyzer");

    // contentHash must hash exactly the deterministic rendered bytes: re-rendering from the
    // same payload has to reproduce the same hash, since the whole point of a note's hash
    // here is proving the rendering is intact, not that any external document existed.
    const secondImport = await importEvidencePayload(payload, { project: baseProject(), categoryId: "complaint_details" });
    expect(secondImport.project.evidence[0]?.contentHash).toBe(item.contentHash);
  });

  it("rejects an attachment whose bytes don't match its declared content_hash, and imports nothing", async () => {
    const payload = clone();
    payload.attachments[0].content_hash = "0".repeat(64);
    payload.integrity.payload_hash = await computePayloadHash(payload);

    const project = baseProject();
    await expect(importEvidencePayload(payload, { project, categoryId: "product_information" })).rejects.toThrow(EvidenceInterchangeError);
    expect(saveProjectAndFiles).not.toHaveBeenCalled();
  });

  it("rejects a payload whose integrity hash doesn't match its contents", async () => {
    const payload = clone();
    payload.evidence_type = "tampered_after_hashing"; // changed without recomputing payload_hash

    await expect(importEvidencePayload(payload, { project: baseProject(), categoryId: "product_information" })).rejects.toThrow(/integrity hash/i);
    expect(saveProjectAndFiles).not.toHaveBeenCalled();
  });

  it("resolveCategoryId routes each attachment to its own matching category, not one shared category for the whole payload", async () => {
    // Regression: a payload mixing a PDF and an image attachment used to be filed entirely
    // under whichever category the FIRST attachment suggested, even when the template has
    // separate categories that each only accept one of the two types.
    const mixedTemplate: TemplateSnapshot = {
      id: "mixed-template", name: "Mixed", version: "1.0.0", jurisdiction: "general", exportSections: [],
      categories: [
        { id: "documents", name: "Documents", description: "", requirement: "recommended", acceptedTypes: ["pdf"] },
        { id: "photos", name: "Photos", description: "", requirement: "recommended", acceptedTypes: ["image"] },
      ],
    };
    const project = createProject({ title: "Mixed test", organisation: "", summary: "", desiredResolution: "", template: mixedTemplate });

    const pdfBytes = new TextEncoder().encode("pdf bytes");
    const imageBytes = new TextEncoder().encode("image bytes");
    let pdfBinary = ""; for (const byte of pdfBytes) pdfBinary += String.fromCharCode(byte);
    let imageBinary = ""; for (const byte of imageBytes) imageBinary += String.fromCharCode(byte);
    const payload = {
      schema_version: 1 as const,
      source: { producer_id: "com.example.mixed-tool", producer_name: "Example Mixed Tool" },
      capture_timestamp: "2026-08-04T09:15:00Z",
      evidence_type: "mixed_evidence_bundle",
      attachments: [
        { id: "att-pdf", filename: "doc.pdf", mime_type: "application/pdf" as const, size: pdfBytes.length, content_hash: await sha256Hex(pdfBytes), encoding: "base64" as const, data: btoa(pdfBinary) },
        { id: "att-img", filename: "photo.png", mime_type: "image/png" as const, size: imageBytes.length, content_hash: await sha256Hex(imageBytes), encoding: "base64" as const, data: btoa(imageBinary) },
      ],
      observations: [],
      integrity: { algorithm: "sha256" as const, canonicalization: "RFC8785" as const, payload_hash: "0".repeat(64) },
    };
    payload.integrity.payload_hash = await computePayloadHash(payload);

    const result = await importEvidencePayload(payload, {
      project, categoryId: "documents",
      resolveCategoryId: (sourceType) => (sourceType === "pdf" ? "documents" : sourceType === "image" ? "photos" : undefined),
    });

    expect(result.createdEvidenceIds).toHaveLength(2);
    const pdfItem = result.project.evidence.find((item) => item.sourceType === "pdf");
    const imageItem = result.project.evidence.find((item) => item.sourceType === "image");
    expect(pdfItem?.categoryId).toBe("documents");
    expect(imageItem?.categoryId).toBe("photos");
  });

  it("rejects the whole import, rather than silently falling back to categoryId, when resolveCategoryId can't place one of the attachment types", async () => {
    const pdfOnlyTemplate: TemplateSnapshot = {
      id: "pdf-only-template", name: "PDF only", version: "1.0.0", jurisdiction: "general", exportSections: [],
      categories: [{ id: "documents", name: "Documents", description: "", requirement: "recommended", acceptedTypes: ["pdf"] }],
    };
    const project = createProject({ title: "PDF-only test", organisation: "", summary: "", desiredResolution: "", template: pdfOnlyTemplate });

    const pdfBytes = new TextEncoder().encode("pdf bytes");
    const imageBytes = new TextEncoder().encode("image bytes");
    let pdfBinary = ""; for (const byte of pdfBytes) pdfBinary += String.fromCharCode(byte);
    let imageBinary = ""; for (const byte of imageBytes) imageBinary += String.fromCharCode(byte);
    const payload = {
      schema_version: 1 as const,
      source: { producer_id: "com.example.mixed-tool", producer_name: "Example Mixed Tool" },
      capture_timestamp: "2026-08-04T09:15:00Z",
      evidence_type: "mixed_evidence_bundle",
      attachments: [
        { id: "att-pdf", filename: "doc.pdf", mime_type: "application/pdf" as const, size: pdfBytes.length, content_hash: await sha256Hex(pdfBytes), encoding: "base64" as const, data: btoa(pdfBinary) },
        { id: "att-img", filename: "photo.png", mime_type: "image/png" as const, size: imageBytes.length, content_hash: await sha256Hex(imageBytes), encoding: "base64" as const, data: btoa(imageBinary) },
      ],
      observations: [],
      integrity: { algorithm: "sha256" as const, canonicalization: "RFC8785" as const, payload_hash: "0".repeat(64) },
    };
    payload.integrity.payload_hash = await computePayloadHash(payload);

    await expect(importEvidencePayload(payload, {
      project, categoryId: "documents",
      resolveCategoryId: (sourceType) => (sourceType === "pdf" ? "documents" : undefined),
    })).rejects.toThrow(/no category.*accepts evidence of type "image"/i);
    expect(saveProjectAndFiles).not.toHaveBeenCalled();
  });

  it("rejects an unknown category before touching storage", async () => {
    await expect(importEvidencePayload(fixture, { project: baseProject(), categoryId: "does-not-exist" })).rejects.toThrow(/not part of this project's template/);
    expect(saveProjectAndFiles).not.toHaveBeenCalled();
  });

  it("rejects a structurally invalid payload with the underlying issues attached", async () => {
    const payload = clone(); delete payload.source;
    try {
      await importEvidencePayload(payload, { project: baseProject(), categoryId: "product_information" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceInterchangeError);
      expect((error as InstanceType<typeof EvidenceInterchangeError>).issues.length).toBeGreaterThan(0);
    }
    expect(saveProjectAndFiles).not.toHaveBeenCalled();
  });

  it("leaves the original project object untouched on any rejection (no partial mutation)", async () => {
    const project = baseProject();
    const payload = clone(); payload.attachments[0].content_hash = "0".repeat(64);
    payload.integrity.payload_hash = await computePayloadHash(payload);
    await expect(importEvidencePayload(payload, { project, categoryId: "product_information" })).rejects.toThrow();
    expect(project.evidence).toHaveLength(0);
  });

  it("propagates a failure during persistence itself — not only validation failures — leaving the caller's original project untouched", async () => {
    // Every check (schema, category, both hashes) passes; only the storage write fails.
    // packages/storage/tests/storage.test.ts covers saveProjectAndFiles's own atomicity in
    // detail — this test covers the layer above it: that importEvidencePayload doesn't
    // swallow a persistence failure, doesn't report success, and doesn't leave the caller
    // holding a project object that looks updated when nothing was actually saved.
    saveProjectAndFiles.mockRejectedValueOnce(new Error("simulated IndexedDB failure"));
    const project = baseProject();

    await expect(importEvidencePayload(fixture, { project, categoryId: "product_information" })).rejects.toThrow("simulated IndexedDB failure");

    // The caller passed in `project`; importEvidencePayload never mutates its argument
    // in place (addEvidence returns a new object) — so this is really asserting that no
    // separate, successful path silently updated the caller's reference before the throw.
    expect(project.evidence).toHaveLength(0);
    expect(saveProjectAndFiles).toHaveBeenCalledTimes(1);
  });
});
