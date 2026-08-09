// This is the ONLY file in this package that imports @tracepack/* packages. It is the
// verification harness, not the producer — it proves Tracepack's REAL importEvidencePayload()
// accepts a payload built by ../src/producer.ts (which has zero @tracepack imports), and that
// the full pipeline actually happens end to end:
//
//   1-6. producer read the public SPEC, built its own envelope, computed its own hashes
//   7.   payload accepted by the real importer (no throw)
//   8.   provenance preserved, matching exactly what the producer declared
//   9.   the observation preserved, attributed to the producer
//   10.  the receipt genuinely routed through Tracepack's own PII scanner
//   11.  filed into the project, genuinely persisted via the real storage layer
//   12.  exported through the real export-engine path
//   13.  a real PDF produced
//   14.  the exported PDF attributes the observation to the producer, never to Tracepack
//
// One mock, deliberately: @tracepack/document-engine's inspectPdf() is written for its real
// runtime home (a browser tab with a bundler-resolved pdf.js worker), not plain Node — the
// same reason packages/evidence-interchange/tests/pdf-pii-scan.test.ts mocks it. Mocking it
// here proves the pipeline ROUTES the attachment through Tracepack's own scanner (asserted
// below by checking it was called with the producer's real bytes) without re-testing pdf.js
// text extraction itself, which is already covered by document-engine's own test suite.
// Nothing else is mocked: storage runs against a real (fake) IndexedDB, and import/export run
// as real code.

import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

const inspectPdf = vi.fn();
vi.mock("@tracepack/document-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepack/document-engine")>();
  return { ...actual, inspectPdf: (...args: unknown[]) => inspectPdf(...args) };
});

const { importEvidencePayload } = await import("@tracepack/evidence-interchange");
const { createProject } = await import("@tracepack/evidence-core");
const { getEvidenceFile } = await import("@tracepack/storage");
const { buildEvidencePack, buildManifest } = await import("@tracepack/export-engine");
const { buildConsumerRightsHelperPayload } = await import("../src/producer");

import type { TemplateSnapshot } from "@tracepack/evidence-core";

const template: TemplateSnapshot = {
  id: "warranty-claim", name: "Warranty claim", version: "1.0.0", jurisdiction: "general", exportSections: [],
  categories: [
    { id: "warranty_evidence", name: "Warranty evidence", description: "", requirement: "required", acceptedTypes: ["pdf", "image", "note"] },
  ],
};

describe("clean-room producer: Consumer Rights Helper", () => {
  beforeEach(() => { inspectPdf.mockReset(); });

  it("is accepted end to end by Tracepack's real import -> storage -> export pipeline", async () => {
    const { payload, attachmentBytes } = await buildConsumerRightsHelperPayload();

    inspectPdf.mockResolvedValue({
      pageCount: 1,
      text: "Kitchen Gadgets Ltd Order #48213 Espresso Grinder Pro Qty 1 Total: GBP 89.99 Purchased: 2026-06-14",
      textStatus: "complete",
      findings: [],
    });

    const project = createProject({
      title: "Espresso grinder warranty claim", organisation: "", summary: "",
      desiredResolution: "Replacement under warranty", template,
    });

    // 1-6: the producer built its own envelope and computed its own hashes independently;
    // this is where that payload first touches Tracepack's real code.
    const result = await importEvidencePayload(payload, { project, categoryId: "warranty_evidence" });

    // 7: accepted — no throw, a real EvidenceItem was created.
    expect(result.createdEvidenceIds).toHaveLength(1);
    const item = result.project.evidence[0]!;

    // 8: provenance preserved, matching exactly what the producer declared.
    expect(item.provenance).toEqual({
      producerId: "org.example.consumer-rights-helper",
      producerName: "Consumer Rights Helper",
      producerVersion: "1.0.0",
      schemaVersion: 1,
      capturedAt: "2026-06-20T10:15:00Z",
      sourceUrl: "https://consumerrightshelper.example/claims/8821",
    });

    // 9: the observation is preserved, attributed to the producer, never turned into a
    // Tracepack finding.
    expect(item.observations).toHaveLength(1);
    expect(item.observations?.[0]?.kind).toBe("warranty_period_active");
    expect(item.privacyFindings ?? []).toHaveLength(0);

    // 10: the receipt genuinely went through Tracepack's own PII scan routing — inspectPdf
    // was actually called, with the producer's real attachment bytes, not skipped.
    expect(inspectPdf).toHaveBeenCalledTimes(1);
    const [scannedBlob] = inspectPdf.mock.calls[0]!;
    expect(new Uint8Array(await scannedBlob.arrayBuffer())).toEqual(attachmentBytes);

    // 11: filed into the project, genuinely persisted via the real storage layer (not
    // mocked) — fetched back from (fake) IndexedDB, not reused from memory.
    const stored = await getEvidenceFile(item.id);
    expect(stored?.blob).toBeInstanceOf(Blob);
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(attachmentBytes);

    // 12-13: exported through the real export-engine path, producing a real PDF.
    const files = new Map([[item.id, stored!.blob]]);
    const packBlob = await buildEvidencePack(result.project, files);
    expect(packBlob.type).toBe("application/pdf");
    const packBytes = new Uint8Array(await packBlob.arrayBuffer());
    expect(new TextDecoder().decode(packBytes.slice(0, 5))).toBe("%PDF-");

    // 14: the exported PDF attributes the observation to the producer, never to Tracepack.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: packBytes }).promise;
    let fullText = "";
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const content = await (await doc.getPage(pageNumber)).getTextContent();
      fullText += content.items.map((i) => ("str" in i ? i.str : "")).join(" ") + " ";
    }
    expect(fullText).toContain("Consumer Rights Helper");
    expect(fullText).toContain("Purchase within 24-month warranty window");
    expect(fullText).toContain("Kitchen Gadgets Ltd's published returns");
    expect(fullText).toContain("Not independently verified by Tracepack");
    expect(fullText).not.toMatch(/Tracepack (found|detected|determined)/i);

    // The JSON manifest also carries provenance and the self-asserted-identity notice.
    const manifest = buildManifest(result.project);
    expect(manifest.producerIdentityNotice).toContain("self-asserted");
    expect(manifest.evidence[0]?.provenance?.producerName).toBe("Consumer Rights Helper");
  });

  it("is rejected if the producer's own hash computation were wrong -- proving the check is real, not decorative", async () => {
    const { payload } = await buildConsumerRightsHelperPayload();
    const tampered = { ...payload, evidence_type: "tampered_after_hashing" };
    const project = createProject({ title: "Test", organisation: "", summary: "", desiredResolution: "", template });
    await expect(importEvidencePayload(tampered, { project, categoryId: "warranty_evidence" })).rejects.toThrow(/integrity hash/i);
  });
});
