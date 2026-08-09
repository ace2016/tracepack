import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type TemplateSnapshot, type TracepackProject } from "@tracepack/evidence-core";

// document-engine's inspectPdf() is written for its real runtime home (a browser tab with
// a bundler-resolved pdf.js worker) — it isn't meant to run standalone under plain Node,
// and nothing else in this repo does that either (export-engine's tests read PDF text back
// out via pdfjs's own "legacy" build directly, never through inspectPdf). What actually
// needs coverage here is narrower: that importEvidencePayload calls inspectPdf for every
// PDF attachment and threads its result onto the created EvidenceItem correctly. Mocking
// document-engine at this boundary — the same way tests/import.test.ts already mocks
// @tracepack/storage — tests exactly that, without re-testing pdf.js text extraction
// (already covered by document-engine's own tests/privacy.test.ts).
const inspectPdf = vi.fn();
vi.mock("@tracepack/document-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepack/document-engine")>();
  return { ...actual, inspectPdf: (...args: unknown[]) => inspectPdf(...args) };
});

const saveProjectAndFiles = vi.fn().mockResolvedValue(undefined);
vi.mock("@tracepack/storage", () => ({ saveProjectAndFiles: (...args: unknown[]) => saveProjectAndFiles(...args) }));

const { importEvidencePayload } = await import("../src/import");
const { computePayloadHash, sha256Hex } = await import("@tracepack/evidence-sdk");

const template: TemplateSnapshot = {
  id: "test-template", name: "Test", version: "1.0.0", jurisdiction: "general", exportSections: [],
  categories: [{ id: "product_information", name: "Product information", description: "", requirement: "recommended", acceptedTypes: ["pdf", "image", "webpage", "note"] }],
};

function baseProject(): TracepackProject {
  return createProject({ title: "Test case", organisation: "", summary: "", desiredResolution: "", template });
}

async function buildPayload(pdfBytes: Uint8Array) {
  const contentHash = await sha256Hex(pdfBytes);
  let binary = ""; for (const byte of pdfBytes) binary += String.fromCharCode(byte);
  const payload = {
    schema_version: 1 as const,
    source: { producer_id: "com.example.doc-tool", producer_name: "Example Document Tool" },
    capture_timestamp: "2026-08-04T09:15:00Z",
    evidence_type: "customer_correspondence",
    attachments: [{
      id: "att-1", filename: "correspondence.pdf", mime_type: "application/pdf" as const,
      size: pdfBytes.length, content_hash: contentHash, encoding: "base64" as const, data: btoa(binary),
    }],
    observations: [],
    integrity: { algorithm: "sha256" as const, canonicalization: "RFC8785" as const, payload_hash: "0".repeat(64) },
  };
  payload.integrity.payload_hash = await computePayloadHash(payload);
  return payload;
}

describe("importEvidencePayload — PDF attachments go through Tracepack's own PII scan", () => {
  beforeEach(() => { saveProjectAndFiles.mockClear(); inspectPdf.mockReset(); });

  it("calls inspectPdf for a PDF attachment and threads pageCount/extractedText/findings onto the created item, exactly like a manual upload would", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake bytes for this test");
    inspectPdf.mockResolvedValue({
      pageCount: 1,
      text: "Contact alex@example.com for a refund.",
      textStatus: "complete",
      findings: [{ id: "email-0-0", kind: "email", label: "Email address", value: "alex@example.com", excerpt: "Contact alex@example.com for a refund.", decision: "unreviewed", location: { pageNumber: 1, x: 20, y: 150, width: 100, height: 12 } }],
    });

    const payload = await buildPayload(pdfBytes);
    const result = await importEvidencePayload(payload, { project: baseProject(), categoryId: "product_information" });
    const item = result.project.evidence[0]!;

    expect(inspectPdf).toHaveBeenCalledTimes(1);
    expect(item.sourceType).toBe("pdf");
    expect(item.pageCount).toBe(1);
    expect(item.textExtractionStatus).toBe("complete");
    expect(item.extractedText).toBe("Contact alex@example.com for a refund.");

    // The scan is Tracepack's own — the finding must be unreviewed, exactly like a
    // manually-uploaded PDF, so the existing redact-or-keep review queue picks it up.
    expect(item.privacyFindings).toHaveLength(1);
    expect(item.privacyFindings?.[0]?.kind).toBe("email");
    expect(item.privacyFindings?.[0]?.value).toBe("alex@example.com");
    expect(item.privacyFindings?.[0]?.decision).toBe("unreviewed");

    // A detector finding is Tracepack's own output, not a producer claim — it must never be
    // confused with (or substitute for) the item's external observations.
    expect(item.observations).toEqual([]);
  });

  it("does not call inspectPdf for a non-PDF attachment", async () => {
    const pngBytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (char) => char.charCodeAt(0));
    const contentHash = await sha256Hex(pngBytes);
    let binary = ""; for (const byte of pngBytes) binary += String.fromCharCode(byte);
    const payload = {
      schema_version: 1 as const,
      source: { producer_id: "com.example.tool", producer_name: "Example Tool" },
      capture_timestamp: "2026-08-04T09:15:00Z",
      evidence_type: "product_listing_review_analysis",
      attachments: [{ id: "att-1", filename: "shot.png", mime_type: "image/png" as const, size: pngBytes.length, content_hash: contentHash, encoding: "base64" as const, data: btoa(binary) }],
      observations: [],
      integrity: { algorithm: "sha256" as const, canonicalization: "RFC8785" as const, payload_hash: "0".repeat(64) },
    };
    payload.integrity.payload_hash = await computePayloadHash(payload);

    const result = await importEvidencePayload(payload, { project: baseProject(), categoryId: "product_information" });
    expect(inspectPdf).not.toHaveBeenCalled();
    // Non-PDF attachments skip the body scan, but title/filename are still checked.
    expect(result.project.evidence[0]?.privacyFindings).toEqual([]);
  });

  it("flags PII in a producer-supplied filename, exactly like a title/filename typed inside Tracepack", async () => {
    const pngBytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (char) => char.charCodeAt(0));
    const contentHash = await sha256Hex(pngBytes);
    let binary = ""; for (const byte of pngBytes) binary += String.fromCharCode(byte);
    const payload = {
      schema_version: 1 as const,
      source: { producer_id: "com.example.tool", producer_name: "Example Tool" },
      capture_timestamp: "2026-08-04T09:15:00Z",
      evidence_type: "product_listing_review_analysis",
      attachments: [{ id: "att-1", filename: "complaint-alex@example.com.png", mime_type: "image/png" as const, size: pngBytes.length, content_hash: contentHash, encoding: "base64" as const, data: btoa(binary) }],
      observations: [],
      integrity: { algorithm: "sha256" as const, canonicalization: "RFC8785" as const, payload_hash: "0".repeat(64) },
    };
    payload.integrity.payload_hash = await computePayloadHash(payload);

    const result = await importEvidencePayload(payload, { project: baseProject(), categoryId: "product_information" });
    const item = result.project.evidence[0]!;
    expect(item.originalFileName).toBe("complaint-alex@example.com.png");
    // The derived title ("Complaint Alex@example.com" -- humanizeFilename title-cases each
    // word, so the leading letter of the email is capitalized) carries the same PII as the
    // filename it came from, so both fields are flagged separately. Case-insensitive check:
    // the filename finding keeps the producer's exact original casing, the title finding
    // doesn't, and both are still correctly detected (document-engine's email pattern is
    // case-insensitive) -- this asserts detection survived humanization, not exact casing.
    expect(item.privacyFindings?.map((f) => f.field).sort()).toEqual(["filename", "title"]);
    expect(item.privacyFindings?.every((f) => f.value.toLowerCase().includes("alex@example.com") && f.decision === "unreviewed")).toBe(true);
  });
});
