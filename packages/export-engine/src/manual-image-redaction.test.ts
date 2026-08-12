import { describe, expect, it } from "vitest";
import type { TracepackProject } from "@tracepack/evidence-core";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, degrees } from "pdf-lib";
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

  it("requires a page number for every manual PDF region", async () => {
    const project = projectWithManualDecision("remove");
    project.evidence[0] = {
      ...project.evidence[0]!,
      sourceType: "pdf",
      mimeType: "application/pdf",
      manualRedactions: [{ id: "pdf-region-1", kind: "pdf-region", x: .1, y: .2, width: .3, height: .1, decision: "remove", createdAt: "2026-08-10T00:00:00.000Z" }],
    };

    await expect(buildEvidencePack(project, new Map())).rejects.toThrow("Choose a PDF page for 1 manual redaction before export");
  });

  it("rejects a manual PDF removal targeting a page outside the document", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("remove");
    project.evidence[0] = {
      ...project.evidence[0]!,
      sourceType: "pdf",
      mimeType: "application/pdf",
      manualRedactions: [{ id: "pdf-region-2", kind: "pdf-region", pageNumber: 2, x: .1, y: .2, width: .3, height: .1, decision: "remove", createdAt: "2026-08-10T00:00:00.000Z" }],
    };

    await expect(buildEvidencePack(project, new Map([["image-1", sourceBlob]]))).rejects.toThrow("outside the 1-page document");
  });

  it.each([
    ["not a number", { x: Number.NaN }],
    ["infinite", { width: Number.POSITIVE_INFINITY }],
    ["left of the page", { x: -.1 }],
    ["below the page", { y: 1 }],
    ["empty", { width: 0 }],
    ["negative", { height: -.1 }],
  ])("rejects a %s manual PDF removal rectangle", async (_label, replacement) => {
    const project = projectWithManualDecision("remove");
    project.evidence[0] = {
      ...project.evidence[0]!,
      sourceType: "pdf",
      mimeType: "application/pdf",
      manualRedactions: [{
        id: "pdf-region-invalid",
        kind: "pdf-region",
        pageNumber: 1,
        x: .1,
        y: .2,
        width: .3,
        height: .1,
        decision: "remove",
        createdAt: "2026-08-10T00:00:00.000Z",
        ...replacement,
      }],
    };

    await expect(buildEvidencePack(project, new Map())).rejects.toThrow("Redraw 1 invalid PDF redaction region before export");
  });

  it("passes an approved manual PDF selection to the secure page rasterizer", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("remove");
    project.evidence[0] = {
      ...project.evidence[0]!,
      sourceType: "pdf",
      mimeType: "application/pdf",
      manualRedactions: [{ id: "pdf-region-1", kind: "pdf-region", pageNumber: 1, x: .1, y: .2, width: .3, height: .1, decision: "remove", createdAt: "2026-08-10T00:00:00.000Z" }],
    };
    const onePixelJpeg = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////2wBDAf//////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k="), (character) => character.charCodeAt(0));
    let receivedManualSelection = false;

    await buildEvidencePack(project, new Map([["image-1", sourceBlob]]), async (_file, pageNumber, findings, manualRegions) => {
      receivedManualSelection = pageNumber === 1 && findings.length === 0 && manualRegions?.[0]?.id === "pdf-region-1";
      return { bytes: onePixelJpeg.buffer, width: 300, height: 400 };
    });

    expect(receivedManualSelection).toBe(true);
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

  it("preserves a custom crop box's content and moves annotations into the new page's coordinate space", async () => {
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
    // The new page is always a clean, freshly-created page sized to exactly the source crop
    // box plus the footer strip -- it never reuses or offsets by the source's own box origin,
    // since (unlike the old in-place-growth approach) nothing about the source page's
    // coordinate space is reused here at all.
    expect(evidencePage.getWidth()).toBe(280);
    expect(evidencePage.getHeight()).toBe(406);
    expect(evidencePage.getCropBox()).toEqual({ x: 0, y: 0, width: 280, height: 406 });

    // Annotation coordinates are translated from the source's absolute space into the new
    // page's space: subtract the crop origin (10, 20), then add the footer offset (46).
    const annotations = evidencePage.node.Annots();
    const copiedAnnotation = annotations?.lookup(0, PDFDict);
    const rect = copiedAnnotation?.lookup(PDFName.of("Rect"), PDFArray);
    const quadPoints = copiedAnnotation?.lookup(PDFName.of("QuadPoints"), PDFArray);
    expect(Array.from({ length: rect?.size() ?? 0 }, (_, index) => rect?.lookup(index, PDFNumber)?.asNumber())).toEqual([20, 66, 120, 86]);
    expect(Array.from({ length: quadPoints?.size() ?? 0 }, (_, index) => quadPoints?.lookup(index, PDFNumber)?.asNumber())).toEqual([20, 86, 120, 86, 20, 66, 120, 66]);
  });

  it("clips the embedded page to exactly the source CropBox, never the full MediaBox", async () => {
    // A CropBox bottom above the MediaBox's is exactly how a producer visually hides content
    // without deleting it. The earlier in-place approach grew the copied page's own CropBox
    // while translating its content, which (worked through the geometry) pulled up to
    // footerHeight of that hidden strip back into the visible window. This version never
    // touches the source page's coordinate space -- it embeds the page as a Form XObject
    // whose /BBox is set to exactly the source CropBox, a hard clip every conforming PDF
    // renderer must honor, then draws that clipped embed onto a brand-new, always-blank page.
    // This test asserts the actual safety contract directly: the embedded XObject's /BBox in
    // the saved bytes must match the source CropBox precisely, not the full MediaBox -- if a
    // future change embedded the whole page instead of just the crop, this catches it.
    const source = await PDFDocument.create();
    const page = source.addPage([300, 400]);
    page.setCropBox(0, 50, 300, 350);
    page.drawText("visible", { x: 10, y: 60 });
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const exported = await PDFDocument.load(await result.arrayBuffer());
    const evidencePage = exported.getPage(2);
    expect(evidencePage.getWidth()).toBe(300);
    expect(evidencePage.getHeight()).toBe(396);

    const xObjects = evidencePage.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const forms = (xObjects?.keys() ?? []).map((key) => xObjects!.lookup(key, PDFStream)).filter((value): value is PDFStream => value instanceof PDFStream);
    expect(forms).toHaveLength(1);
    const bbox = forms[0]!.dict.lookup(PDFName.of("BBox"), PDFArray);
    expect(Array.from({ length: bbox.size() }, (_, index) => bbox.lookup(index, PDFNumber).asNumber())).toEqual([0, 50, 300, 400]);
  });

  it("reproduces a rotated imported page upright, with the footer on its visual bottom edge", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 400]);
    page.setRotation(degrees(90));
    page.drawText("rotated", { x: 10, y: 10 });
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const exported = await PDFDocument.load(await result.arrayBuffer());
    const evidencePage = exported.getPage(2);
    // A source page that displays as 400 wide x 300 tall once its own /Rotate is applied
    // (portrait 300x400, rotated 90) must produce a new page sized to match that visual
    // orientation, not the raw unrotated 300x400 -- otherwise the footer ends up reserved
    // along the wrong (visual) edge, exactly Codex's "displaced sideways" finding.
    expect(evidencePage.getWidth()).toBe(400);
    expect(evidencePage.getHeight()).toBe(346);
    expect(evidencePage.getRotation().angle).toBe(0);
  });

  it("preserves /UserUnit and a page-level /Group on the replacement page", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 400]);
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    page.node.set(PDFName.of("Group"), source.context.obj({ Type: "Group", S: "Transparency", CS: "DeviceRGB", I: true }));
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const exported = await PDFDocument.load(await result.arrayBuffer());
    const evidencePage = exported.getPage(2);
    expect(evidencePage.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber)?.asNumber()).toBe(2);
    const group = evidencePage.node.lookupMaybe(PDFName.of("Group"), PDFDict);
    expect(group?.lookup(PDFName.of("S"))?.toString()).toBe("/Transparency");
    expect(group?.lookup(PDFName.of("I"))?.toString()).toBe("true");
  });

  it("keeps a rotated annotation's cached appearance undistorted by composing the same rotation into its Matrix", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 400]);
    page.setRotation(degrees(90));
    // BBox and Rect share the same 40x20 aspect ratio before rotation -- an unmodified 1:1 fit.
    const appearance = source.context.flateStream("", { Type: "XObject", Subtype: "Form", FormType: 1, BBox: [0, 0, 40, 20] });
    const appearanceRef = source.context.register(appearance);
    const annotation = source.context.obj({ Type: "Annot", Subtype: "Stamp", Rect: [10, 10, 50, 30], AP: { N: appearanceRef }, Border: [0, 0, 0] });
    const annotationRef = source.context.register(annotation);
    page.node.set(PDFName.of("Annots"), source.context.obj([annotationRef]));
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const exported = await PDFDocument.load(await result.arrayBuffer());
    const evidencePage = exported.getPage(2);
    const copiedAnnotation = evidencePage.node.Annots()?.lookup(0, PDFDict);
    const rect = copiedAnnotation?.lookup(PDFName.of("Rect"), PDFArray);
    const rectValues = Array.from({ length: 4 }, (_, index) => rect!.lookup(index, PDFNumber).asNumber());
    const rectWidth = rectValues[2]! - rectValues[0]!;
    const rectHeight = rectValues[3]! - rectValues[1]!;
    // 90 degrees swaps the transformed Rect's own width/height (40x20 -> 20x40) -- that alone
    // is expected and matches every other geometry transform in this file.
    expect([rectWidth, rectHeight]).toEqual([20, 40]);

    // The real question: does the appearance's OWN transformed bounding box now match that
    // same 20x40 shape, so the viewer's BBox-to-Rect fit (PDF 32000-1 12.5.5) stays undistorted?
    // Recomputed independently here via the spec's own row-vector formula, not by re-calling
    // this file's composeMatrix -- a genuine check on the consequence, not just the number.
    const copiedAp = copiedAnnotation?.lookupMaybe(PDFName.of("AP"), PDFDict);
    const copiedNormal = copiedAp?.lookupMaybe(PDFName.of("N"), PDFStream);
    const bbox = copiedNormal!.dict.lookup(PDFName.of("BBox"), PDFArray);
    const bboxValues = Array.from({ length: 4 }, (_, index) => bbox.lookup(index, PDFNumber).asNumber());
    const matrix = copiedNormal!.dict.lookup(PDFName.of("Matrix"), PDFArray);
    const [a, b, c, d, e, f] = Array.from({ length: 6 }, (_, index) => matrix.lookup(index, PDFNumber).asNumber());
    const corners: [number, number][] = [[bboxValues[0]!, bboxValues[1]!], [bboxValues[2]!, bboxValues[1]!], [bboxValues[0]!, bboxValues[3]!], [bboxValues[2]!, bboxValues[3]!]];
    const transformed = corners.map(([x, y]): [number, number] => [a! * x + c! * y + e!, b! * x + d! * y + f!]);
    const xs = transformed.map((point) => point[0]); const ys = transformed.map((point) => point[1]);
    const transformedWidth = Math.max(...xs) - Math.min(...xs);
    const transformedHeight = Math.max(...ys) - Math.min(...ys);
    expect(transformedWidth).toBeCloseTo(rectWidth, 6);
    expect(transformedHeight).toBeCloseTo(rectHeight, 6);
  });

  it("truncates the footer title so it never runs into the page-number label on a narrow page", async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]); // narrow enough that the full title cannot fit
    const sourceBytes = await source.save();
    const sourceBlob = new Blob([sourceBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const project = projectWithManualDecision("keep");
    project.title = "A Very Long Evidence Pack Title That Will Not Fit On A Narrow Imported Page";
    project.evidence[0] = { ...project.evidence[0]!, sourceType: "pdf", mimeType: "application/pdf", manualRedactions: [] };

    const result = await buildEvidencePack(project, new Map([["image-1", sourceBlob]]));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document_ = await pdfjs.getDocument({ data: new Uint8Array(await result.arrayBuffer()) }).promise;
    const evidencePage = await document_.getPage(3); // 1-indexed; page 2 (0-indexed) above
    const content = await evidencePage.getTextContent();
    const strings = content.items.map((item) => ("str" in item ? item.str : ""));
    const titleText = strings.find((text) => text.length > 0 && project.title.startsWith(text));
    expect(titleText).toBeDefined();
    // Truncated, not the full title -- and what IS drawn must be a genuine prefix, not garbled.
    expect(titleText!.length).toBeLessThan(project.title.length);
    expect(project.title.startsWith(titleText!)).toBe(true);
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
