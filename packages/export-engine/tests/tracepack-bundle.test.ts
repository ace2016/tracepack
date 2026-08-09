import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildManifest, buildTracepackBundle } from "../src/index";
import type { TracepackProject } from "@tracepack/evidence-core";

describe(".tracepack bundle", () => {
  it("zips exactly manifest.json and evidence-pack.pdf, both valid and consistent with the standalone exports", async () => {
    const noteBlob = new Blob(["The kettle stopped heating water after two weeks of normal use."], { type: "text/plain" });
    const project: TracepackProject = {
      id: "p1", schemaVersion: 1, title: "Faulty kettle", organisation: "Example Retail",
      summary: "The kettle stopped working.", desiredResolution: "Refund",
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [{
        id: "e1", projectId: "p1", title: "What happened", categoryId: "complaint_details", sourceType: "note",
        importedAt: new Date(0).toISOString(), contentHash: "b".repeat(64), reviewStatus: "reviewed", notes: "",
        size: noteBlob.size, mimeType: "text/plain", extractedText: "The kettle stopped heating water after two weeks of normal use.", textExtractionStatus: "complete",
      }],
    };

    const bundleBlob = await buildTracepackBundle(project, new Map([["e1", noteBlob]]));
    const zipped = new Uint8Array(await bundleBlob.arrayBuffer());
    const entries = unzipSync(zipped);

    expect(Object.keys(entries).sort()).toEqual(["evidence-pack.pdf", "manifest.json"]);

    // manifest.json inside the bundle has the same shape buildManifest produces standalone —
    // the bundle doesn't get its own divergent manifest shape. exportedAt is excluded from
    // the comparison since each buildManifest() call stamps its own current timestamp.
    const manifestInBundle = JSON.parse(strFromU8(entries["manifest.json"]!));
    const { exportedAt: _bundleExportedAt, ...bundleManifestRest } = manifestInBundle;
    const { exportedAt: _standaloneExportedAt, ...standaloneManifestRest } = JSON.parse(JSON.stringify(buildManifest(project)));
    expect(bundleManifestRest).toEqual(standaloneManifestRest);
    expect(manifestInBundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // evidence-pack.pdf inside the bundle is a real, valid, correctly-built PDF — same
    // content a standalone buildEvidencePack call would produce (cover, index, note page).
    const pdf = await PDFDocument.load(entries["evidence-pack.pdf"]!);
    expect(pdf.getPageCount()).toBe(3);
  });

  it("never embeds raw, un-redacted attachment bytes -- only the already-redacted PDF and the manifest", async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([200, 200]);
    page.drawText("secret@example.com", { x: 20, y: 100, font, size: 12 });
    const sourceBlob = new Blob([await source.save()], { type: "application/pdf" });

    const project: TracepackProject = {
      id: "p2", schemaVersion: 1, title: "Redaction test", organisation: "Example", summary: "Test", desiredResolution: "None",
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
      evidence: [{
        id: "e1", projectId: "p2", title: "Private email", categoryId: "other", sourceType: "pdf", originalFileName: "private.pdf",
        importedAt: new Date(0).toISOString(), contentHash: "a".repeat(64), reviewStatus: "reviewed", notes: "",
        size: sourceBlob.size, mimeType: "application/pdf",
        privacyFindings: [{ id: "f1", kind: "email", label: "Email address", value: "secret@example.com", excerpt: "secret@example.com", decision: "remove", location: { pageNumber: 1, x: 20, y: 100, width: 110, height: 12 } }],
      }],
    };

    const onePixelJpeg = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q=="), (char) => char.charCodeAt(0));
    const bundleBlob = await buildTracepackBundle(project, new Map([["e1", sourceBlob]]), async (_source, pageNumber, findings) => {
      expect(pageNumber === 1 && findings[0]?.value === "secret@example.com").toBe(true);
      return { bytes: onePixelJpeg.buffer, width: 200, height: 200 };
    });

    const zipped = new Uint8Array(await bundleBlob.arrayBuffer());
    const entries = unzipSync(zipped);
    // Only the two expected entries exist -- no raw/original attachment bytes anywhere in
    // the archive that could bypass the PDF path's redaction.
    expect(Object.keys(entries).sort()).toEqual(["evidence-pack.pdf", "manifest.json"]);
    const wholeArchiveText = new TextDecoder().decode(zipped);
    expect(wholeArchiveText).not.toContain("secret@example.com");
  });
});
