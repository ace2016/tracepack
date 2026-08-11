import { describe, expect, it } from "vitest";
import type { TracepackProject } from "@tracepack/evidence-core";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { buildEvidencePack } from "./index";

function projectWithManualDecision(decision: "unreviewed" | "keep" | "remove"): TracepackProject {
  return {
    id: "project-1",
    schemaVersion: 1,
    title: "Manual redaction test",
    organisation: "",
    summary: "",
    desiredResolution: "",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    template: {
      id: "general",
      version: "1",
      name: "General",
      jurisdiction: "global",
      categories: [{ id: "images", name: "Images", requirement: "optional", description: "", acceptedTypes: ["image"] }],
      exportSections: ["Evidence"],
    },
    evidence: [{
      id: "image-1",
      projectId: "project-1",
      title: "Screenshot",
      categoryId: "images",
      sourceType: "image",
      importedAt: "2026-08-10T00:00:00.000Z",
      contentHash: "0".repeat(64),
      reviewStatus: "reviewed",
      notes: "",
      size: 100,
      mimeType: "image/png",
      manualRedactions: [{ id: "region-1", kind: "image-region", x: .1, y: .2, width: .3, height: .1, decision, createdAt: "2026-08-10T00:00:00.000Z" }],
    }],
  };
}

describe("manual image redaction export gate", () => {
  it("fails closed while a selected image region is still unreviewed", async () => {
    await expect(buildEvidencePack(projectWithManualDecision("unreviewed"), new Map())).rejects.toThrow("Review 1 manual image redaction before export");
  });

  it("ignores unresolved regions on excluded evidence", async () => {
    const project = projectWithManualDecision("unreviewed");
    project.evidence[0]!.reviewStatus = "excluded";
    await expect(buildEvidencePack(project, new Map())).resolves.toBeInstanceOf(Blob);
  });

  it("reserves a footer strip below imported PDF evidence", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const exported = await PDFDocument.load(await result.arrayBuffer());
    const evidencePage = exported.getPage(2);
    expect(evidencePage.getWidth()).toBe(300);
    expect(evidencePage.getHeight()).toBe(446);
  });

  it("preserves a custom crop box and moves annotations with imported content", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 400]);
    page.setCropBox(10, 20, 280, 360);
    const annotation = source.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [30, 40, 130, 60],
      QuadPoints: [30, 60, 130, 60, 30, 40, 130, 40],
      Border: [0, 0, 0],
    });
    const annotationRef = source.context.register(annotation);
    page.node.set(PDFName.of("Annots"), source.context.obj([annotationRef]));
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const exported = await PDFDocument.load(await result.arrayBuffer());
    const evidencePage = exported.getPage(2);
    // The crop's own lower edge (y: 20) must be preserved, not reset to the MediaBox's (y: 0) --
    // only the height grows, by exactly the footer strip.
    expect(evidencePage.getCropBox()).toEqual({ x: 10, y: 20, width: 280, height: 406 });

    const annotations = evidencePage.node.Annots();
    const copiedAnnotation = annotations?.lookup(0, PDFDict);
    const rect = copiedAnnotation?.lookup(PDFName.of("Rect"), PDFArray);
    const quadPoints = copiedAnnotation?.lookup(PDFName.of("QuadPoints"), PDFArray);
    expect(Array.from({ length: rect?.size() ?? 0 }, (_, index) => rect?.lookup(index, PDFNumber)?.asNumber())).toEqual([30, 86, 130, 106]);
    expect(Array.from({ length: quadPoints?.size() ?? 0 }, (_, index) => quadPoints?.lookup(index, PDFNumber)?.asNumber())).toEqual([30, 106, 130, 106, 30, 86, 130, 86]);
  });

  it("does not expose content the source PDF hid below its crop box", async () => {
    // A CropBox bottom above the MediaBox's is exactly how a producer visually hides content
    // without deleting it. Extending the crop down to the MediaBox's bottom, instead of only
    // growing it upward, would pull that hidden strip back into the visible window.
    const source = await PDFDocument.create();
    const page = source.addPage([300, 400]);
    page.setCropBox(0, 50, 300, 350);
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const exported = await PDFDocument.load(await result.arrayBuffer());
    const evidencePage = exported.getPage(2);
    const crop = evidencePage.getCropBox();
    expect(crop.y).toBe(50);
    expect(crop.height).toBe(396);
  });

  it("moves line, polygon, callout and ink annotation geometry with the shifted content", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 400]);
    const line = source.context.obj({ Type: "Annot", Subtype: "Line", L: [10, 20, 90, 20], Border: [0, 0, 0] });
    const polygon = source.context.obj({ Type: "Annot", Subtype: "Polygon", Vertices: [10, 30, 90, 30, 50, 70], Border: [0, 0, 0] });
    const freeText = source.context.obj({ Type: "Annot", Subtype: "FreeText", Rect: [10, 10, 90, 30], CL: [50, 30, 50, 50], Border: [0, 0, 0] });
    const ink = source.context.obj({ Type: "Annot", Subtype: "Ink", InkList: [[5, 5, 15, 15], [20, 20, 30, 30]], Border: [0, 0, 0] });
    const refs = [line, polygon, freeText, ink].map((annotation) => source.context.register(annotation));
    page.node.set(PDFName.of("Annots"), source.context.obj(refs));
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const exported = await PDFDocument.load(await result.arrayBuffer());
    const evidencePage = exported.getPage(2);
    const annotations = evidencePage.node.Annots();
    const numbers = (array: PDFArray | undefined) => Array.from({ length: array?.size() ?? 0 }, (_, index) => array?.lookup(index, PDFNumber)?.asNumber());

    const copiedLine = annotations?.lookup(0, PDFDict);
    expect(numbers(copiedLine?.lookup(PDFName.of("L"), PDFArray))).toEqual([10, 66, 90, 66]);

    const copiedPolygon = annotations?.lookup(1, PDFDict);
    expect(numbers(copiedPolygon?.lookup(PDFName.of("Vertices"), PDFArray))).toEqual([10, 76, 90, 76, 50, 116]);

    const copiedFreeText = annotations?.lookup(2, PDFDict);
    expect(numbers(copiedFreeText?.lookup(PDFName.of("CL"), PDFArray))).toEqual([50, 76, 50, 96]);

    const copiedInk = annotations?.lookup(3, PDFDict);
    const inkList = copiedInk?.lookup(PDFName.of("InkList"), PDFArray);
    const strokes = Array.from({ length: inkList?.size() ?? 0 }, (_, index) => numbers(inkList?.lookup(index, PDFArray)));
    expect(strokes).toEqual([[5, 51, 15, 61], [20, 66, 30, 76]]);
  });
});
