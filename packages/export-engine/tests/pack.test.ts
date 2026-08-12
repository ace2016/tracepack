import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildEvidencePack, buildManifest } from "../src/index";
import { diffManifests, looksLikeTracepackManifest, type TracepackManifest, type TracepackProject } from "@tracepack/evidence-core";

// Without this, pdfjs falls back to measuring glyphs from an embedded-font guess instead of
// its real standard font metrics, which is what the "Ensure that the standardFontDataUrl API
// parameter is provided" warning is about. That fallback is slower per page, not just noisy,
// and is the actual cause of this suite occasionally brushing up against vitest's default
// 5000ms test timeout on a loaded CI runner. pdfjs-dist ships these fonts in its own package;
// `createRequire` resolves its real install location instead of guessing a relative path to
// it. (`import.meta.resolve` would do the same thing, but isn't implemented by vitest's SSR
// module transform, and throws at runtime here.) The legacy Node build reads this path with
// plain `fs` calls, not `fetch`, so it needs a filesystem path, not a `file://` URL -- a
// trailing slash is required, pdfjs appends filenames directly onto this string.
const pdfjsPackageJson = createRequire(import.meta.url).resolve("pdfjs-dist/package.json");
const standardFontDataUrl = `${path.join(path.dirname(pdfjsPackageJson), "standard_fonts").replaceAll("\\", "/")}/`;

describe("evidence pack", () => {
  it("creates a valid cover and index PDF", async () => {
    const project: TracepackProject = { id: "p1", schemaVersion: 1, title: "Faulty kettle", organisation: "Example Retail", summary: "The kettle stopped working.", desiredResolution: "Refund", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), evidence: [], template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] } };
    const blob = await buildEvidencePack(project, new Map());
    const pdf = await PDFDocument.load(await blob.arrayBuffer());
    expect(blob.type).toBe("application/pdf");
    expect(pdf.getPageCount()).toBe(2);
  });

  it("replaces a page containing an approved removal with a flattened image", async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([200, 200]);
    page.drawText("secret@example.com", { x: 20, y: 100, font, size: 12 });
    const sourceBlob = new Blob([await source.save()], { type: "application/pdf" });
    const project: TracepackProject = {
      id: "p2", schemaVersion: 1, title: "Redaction test", organisation: "Example", summary: "Test", desiredResolution: "None", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [{ id: "e1", projectId: "p2", title: "Private email", categoryId: "other", sourceType: "pdf", originalFileName: "private.pdf", importedAt: new Date(0).toISOString(), contentHash: "a".repeat(64), reviewStatus: "reviewed", notes: "", size: sourceBlob.size, mimeType: "application/pdf", privacyFindings: [{ id: "f1", kind: "email", label: "Email address", value: "secret@example.com", excerpt: "secret@example.com", decision: "remove", location: { pageNumber: 1, x: 20, y: 100, width: 110, height: 12 } }] }],
    };
    const onePixelJpeg = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q=="), (char) => char.charCodeAt(0));
    let rasterized = false;
    const blob = await buildEvidencePack(project, new Map([["e1", sourceBlob]]), async (_source, pageNumber, findings) => {
      rasterized = pageNumber === 1 && findings[0]?.value === "secret@example.com";
      return { bytes: onePixelJpeg.buffer, width: 200, height: 200 };
    });
    const exported = await PDFDocument.load(await blob.arrayBuffer());
    expect(rasterized).toBe(true);
    expect(exported.getPageCount()).toBe(3);
    expect(new TextDecoder().decode(await blob.arrayBuffer())).not.toContain("secret@example.com");
  });


  it("fails closed when a custom PDF rasterizer ignores manual regions", async () => {
    const sourcePdf = await PDFDocument.create();
    const page = sourcePdf.addPage([200, 200]);

    page.drawText("private value", {
      x: 20,
      y: 100,
      size: 12,
    });

    const sourceBlob = new Blob(
      [await sourcePdf.save()],
      { type: "application/pdf" },
    );

    const project: TracepackProject = {
      id: "manual-rasterizer-fail-closed",
      schemaVersion: 1,
      title: "Manual PDF redaction",
      organisation: "Example",
      summary: "Test",
      desiredResolution: "None",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),

      template: {
        id: "consumer-complaint",
        name: "Consumer complaint",
        version: "1",
        jurisdiction: "UK",
        categories: [],
        exportSections: [],
      },

      evidence: [{
        id: "manual-pdf",
        projectId: "manual-rasterizer-fail-closed",
        title: "Private PDF",
        categoryId: "other",
        sourceType: "pdf",
        originalFileName: "private.pdf",
        importedAt: new Date(0).toISOString(),
        contentHash: "f".repeat(64),
        reviewStatus: "reviewed",
        notes: "",
        size: sourceBlob.size,
        mimeType: "application/pdf",

        manualRedactions: [{
          id: "manual-region-1",
          kind: "pdf-region",
          pageNumber: 1,
          x: 0.1,
          y: 0.4,
          width: 0.5,
          height: 0.2,
          decision: "remove",
          createdAt: new Date(0).toISOString(),
        }],
      }],
    };

    // Models an existing three-argument rasterizer.
    // It returns a result but ignores the manual region completely.
    const legacyRasterizer = async (
      _source: Blob,
      _pageNumber: number,
      _findings: unknown[],
    ) => ({
      bytes: new ArrayBuffer(0),
      width: 200,
      height: 200,
    });

    const blob = await buildEvidencePack(
      project,
      new Map([["manual-pdf", sourceBlob]]),
      legacyRasterizer,
    );

    const exported = await PDFDocument.load(await blob.arrayBuffer());

    // cover + index + safe omission page
    expect(exported.getPageCount()).toBe(3);

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document_ = await pdfjs.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      standardFontDataUrl,
    }).promise;

    let fullText = "";

    for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
      const content = await (await document_.getPage(pageNumber)).getTextContent();
      fullText += content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
    }

    expect(fullText).toContain("could not be included");
    expect(fullText).not.toContain("private value");
  });

  it("includes a written note as its own page, not silently skipped", async () => {
    const noteBlob = new Blob(["The kettle stopped heating water after two weeks of normal use."], { type: "text/plain" });
    const project: TracepackProject = {
      id: "p3", schemaVersion: 1, title: "Note test", organisation: "Example", summary: "Test", desiredResolution: "None", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [{ id: "e1", projectId: "p3", title: "What happened", categoryId: "complaint_details", sourceType: "note", importedAt: new Date(0).toISOString(), contentHash: "b".repeat(64), reviewStatus: "reviewed", notes: "", size: noteBlob.size, mimeType: "text/plain", extractedText: "The kettle stopped heating water after two weeks of normal use.", textExtractionStatus: "complete" }],
    };
    const blob = await buildEvidencePack(project, new Map([["e1", noteBlob]]));
    const exported = await PDFDocument.load(await blob.arrayBuffer());
    expect(exported.getPageCount()).toBe(3);

    // The browser build of pdfjs-dist needs DOM globals (DOMMatrix) that Node doesn't
    // have; its "legacy" build is the one meant to run outside a browser, so tests use
    // that instead of pulling in a jsdom environment just to read text back out of a PDF.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document_ = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl }).promise;
    const notePage = await document_.getPage(3);
    const content = await notePage.getTextContent();
    const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    expect(pageText).toContain("What happened");
    expect(pageText).toContain("kettle stopped heating water");
  });

  it("attributes an externally-sourced observation to its producer, never to Tracepack", async () => {
    const imageBlob = new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (c) => c.charCodeAt(0))], { type: "image/png" });
    const project: TracepackProject = {
      id: "p4", schemaVersion: 1, title: "Provenance test", organisation: "Example", summary: "Test", desiredResolution: "None", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [{
        id: "e1", projectId: "p4", title: "Product page screenshot", categoryId: "product_information", sourceType: "image",
        importedAt: new Date(0).toISOString(), contentHash: "c".repeat(64), reviewStatus: "reviewed", notes: "",
        size: imageBlob.size, mimeType: "image/png",
        provenance: { producerId: "com.example.tool", producerName: "Example Review Pattern Analyzer", producerVersion: "2.3.0", schemaVersion: 1, capturedAt: new Date(0).toISOString() },
        observations: [{ id: "obs-1", kind: "suspicious_review_clustering", label: "Suspicious review timing pattern", detail: "37% of 5-star reviews were posted within a single 48-hour window.", confidence: 0.82 }],
      }],
    };
    const blob = await buildEvidencePack(project, new Map([["e1", imageBlob]]));
    const exported = await PDFDocument.load(await blob.arrayBuffer());
    // cover, index, image page, observations page
    expect(exported.getPageCount()).toBe(4);

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document_ = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl }).promise;
    const observationsPage = await document_.getPage(4);
    const content = await observationsPage.getTextContent();
    const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");

    expect(pageText).toContain("Example Review Pattern Analyzer");
    expect(pageText).toContain("Suspicious review timing pattern");
    expect(pageText).toContain("Not independently verified by Tracepack");
    // The page must attribute this to the producer, not phrase it as Tracepack's own finding.
    expect(pageText).not.toMatch(/Tracepack (found|detected|determined)/i);
  });

  it("redacts a title/filename finding marked for removal in both the index page and the JSON manifest, without touching the stored item", async () => {
    const noteBlob = new Blob(["Nothing sensitive in the body."], { type: "text/plain" });
    const project: TracepackProject = {
      id: "p5", schemaVersion: 1, title: "Title redaction test", organisation: "Example", summary: "Test", desiredResolution: "None", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [{
        id: "e1", projectId: "p5", title: "Refund for alex@example.com", categoryId: "complaint_details", sourceType: "note",
        importedAt: new Date(0).toISOString(), contentHash: "d".repeat(64), reviewStatus: "reviewed", notes: "",
        size: noteBlob.size, mimeType: "text/plain", extractedText: "Nothing sensitive in the body.", textExtractionStatus: "complete",
        privacyFindings: [{ id: "t1", kind: "email", label: "Email address", value: "alex@example.com", excerpt: "Refund for alex@example.com", decision: "remove", field: "title" }],
      }],
    };

    const manifest = buildManifest(project);
    expect(manifest.evidence[0]?.title).toBe("Refund for [redacted]");
    // The original item is never mutated — only what's written into the export changes.
    expect(project.evidence[0]?.title).toBe("Refund for alex@example.com");

    const blob = await buildEvidencePack(project, new Map([["e1", noteBlob]]));
    const exported = await PDFDocument.load(await blob.arrayBuffer());
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document_ = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl }).promise;
    let fullText = "";
    for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
      const content = await (await document_.getPage(pageNumber)).getTextContent();
      fullText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + " ";
    }
    expect(fullText).toContain("[redacted]");
    expect(fullText).not.toContain("alex@example.com");
  });

  it("redacts a note's body text in the exported PDF when a body finding is marked for removal", async () => {
    const noteBlob = new Blob(["Contact me at jane.doe@example.com about this."], { type: "text/plain" });
    const project: TracepackProject = {
      id: "p9", schemaVersion: 1, title: "Note body redaction test", organisation: "Example", summary: "Test", desiredResolution: "None", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [{
        id: "e1", projectId: "p9", title: "What happened", categoryId: "complaint_details", sourceType: "note",
        importedAt: new Date(0).toISOString(), contentHash: "2".repeat(64), reviewStatus: "reviewed", notes: "",
        size: noteBlob.size, mimeType: "text/plain", extractedText: "Contact me at jane.doe@example.com about this.", textExtractionStatus: "complete",
        privacyFindings: [{ id: "b1", kind: "email", label: "Email address", value: "jane.doe@example.com", excerpt: "Contact me at jane.doe@example.com about this.", decision: "remove", field: "body" }],
      }],
    };
    const blob = await buildEvidencePack(project, new Map([["e1", noteBlob]]));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document_ = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl }).promise;
    let fullText = "";
    for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
      const content = await (await document_.getPage(pageNumber)).getTextContent();
      fullText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + " ";
    }
    expect(fullText).toContain("[redacted]");
    expect(fullText).not.toContain("jane.doe@example.com");
  });

  it("does not abort the whole pack when one stored 'pdf' item cannot be read as a PDF", async () => {
    const corruptedBlob = new Blob(["this is not a real pdf file, just garbage bytes"], { type: "application/pdf" });
    const noteBlob = new Blob(["A separate, valid piece of evidence."], { type: "text/plain" });
    const project: TracepackProject = {
      id: "p8", schemaVersion: 1, title: "Corrupted evidence test", organisation: "Example", summary: "Test", desiredResolution: "None", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [
        { id: "e1", projectId: "p8", title: "Damaged download", categoryId: "other", sourceType: "pdf", originalFileName: "damaged.pdf", importedAt: new Date(0).toISOString(), contentHash: "f".repeat(64), reviewStatus: "reviewed", notes: "", size: corruptedBlob.size, mimeType: "application/pdf", textExtractionStatus: "failed" },
        { id: "e2", projectId: "p8", title: "A working note", categoryId: "complaint_details", sourceType: "note", importedAt: new Date(0).toISOString(), contentHash: "1".repeat(64), reviewStatus: "reviewed", notes: "", size: noteBlob.size, mimeType: "text/plain", extractedText: "A separate, valid piece of evidence.", textExtractionStatus: "complete" },
      ],
    };
    const blob = await buildEvidencePack(project, new Map([["e1", corruptedBlob], ["e2", noteBlob]]));
    const exported = await PDFDocument.load(await blob.arrayBuffer());
    // cover, index, notice page for the corrupted item, note page: the note must still make it in.
    expect(exported.getPageCount()).toBe(4);

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document_ = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl }).promise;
    let fullText = "";
    for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
      const content = await (await document_.getPage(pageNumber)).getTextContent();
      fullText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + " ";
    }
    expect(fullText).toContain("Damaged download");
    expect(fullText).toContain("could not be included");
    expect(fullText).toContain("A working note");
  });

  it("includes provenance/observations in the JSON manifest and an explicit self-asserted-identity notice, only when an item actually has provenance", async () => {
    const noteBlob = new Blob(["Nothing sensitive in the body."], { type: "text/plain" });
    const withoutProvenance: TracepackProject = {
      id: "p6", schemaVersion: 1, title: "No external evidence", organisation: "Example", summary: "Test", desiredResolution: "None", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [{
        id: "e1", projectId: "p6", title: "A manual note", categoryId: "complaint_details", sourceType: "note",
        importedAt: new Date(0).toISOString(), contentHash: "e".repeat(64), reviewStatus: "reviewed", notes: "",
        size: noteBlob.size, mimeType: "text/plain", extractedText: "Nothing sensitive in the body.", textExtractionStatus: "complete",
      }],
    };
    const withoutNoticeManifest = buildManifest(withoutProvenance);
    expect(withoutNoticeManifest.producerIdentityNotice).toBeNull();
    expect(withoutNoticeManifest.evidence[0]?.provenance).toBeNull();
    expect(withoutNoticeManifest.evidence[0]?.observations).toEqual([]);

    const withProvenance: TracepackProject = {
      ...withoutProvenance,
      id: "p7",
      evidence: [{
        ...withoutProvenance.evidence[0]!,
        id: "e2",
        provenance: { producerId: "com.example.tool", producerName: "Example Tool", schemaVersion: 1, capturedAt: new Date(0).toISOString() },
        observations: [{ id: "obs-1", kind: "test_kind", label: "Test observation", detail: "Some claim." }],
      }],
    };
    const withNoticeManifest = buildManifest(withProvenance);
    expect(withNoticeManifest.producerIdentityNotice).toContain("self-asserted");
    expect(withNoticeManifest.producerIdentityNotice).toContain("not cryptographically verified");
    expect(withNoticeManifest.evidence[0]?.provenance?.producerName).toBe("Example Tool");
    expect(withNoticeManifest.evidence[0]?.observations).toHaveLength(1);
  });
});

// @tracepack/evidence-core's diffManifests/looksLikeTracepackManifest are defined against the
// "tracepack-source-manifest" shape by description, not by importing buildManifest -- this
// suite is what actually proves the real buildManifest() output satisfies that description,
// rather than the two packages' shapes silently drifting apart from each other over time.
describe("buildManifest output is compatible with @tracepack/evidence-core's manifest diff", () => {
  const project: TracepackProject = {
    id: "p8", schemaVersion: 1, title: "Diff test", organisation: "Example", summary: "Test", desiredResolution: "None",
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
    evidence: [{
      id: "e1", projectId: "p8", title: "Receipt", categoryId: "proof_of_purchase", sourceType: "pdf", originalFileName: "receipt.pdf",
      importedAt: new Date(0).toISOString(), contentHash: "a".repeat(64), reviewStatus: "reviewed", notes: "",
      size: 10, mimeType: "application/pdf",
    }],
  };

  it("passes looksLikeTracepackManifest", () => {
    expect(looksLikeTracepackManifest(buildManifest(project))).toBe(true);
  });

  it("diffs as fully unchanged against itself", () => {
    const manifest = buildManifest(project) as unknown as TracepackManifest;
    const diff = diffManifests(manifest, manifest);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.contentChanged).toEqual([]);
    expect(diff.metadataChanged).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("detects a real edit between two exports of the same project (e.g. after re-review)", () => {
    const before = buildManifest(project) as unknown as TracepackManifest;
    const reviewedAgain: TracepackProject = { ...project, evidence: [{ ...project.evidence[0]!, title: "Receipt (verified)" }] };
    const after = buildManifest(reviewedAgain) as unknown as TracepackManifest;
    const diff = diffManifests(before, after);
    expect(diff.metadataChanged).toHaveLength(1);
    expect(diff.metadataChanged[0]?.changedFields).toEqual(["title"]);
    expect(diff.contentChanged).toEqual([]);
  });
});
