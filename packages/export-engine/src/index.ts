import { redactText } from "@tracepack/document-engine";
import type { EvidenceItem, ManualImageRedaction, PrivacyFinding, TracepackProject } from "@tracepack/evidence-core";
import { sha256Hex } from "@tracepack/evidence-sdk";
import { strToU8, zipSync } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type Color } from "pdf-lib";

const IMPORTED_PAGE_FOOTER_HEIGHT = 46;

// The four normalized page-rotation cases (ISO 32000's /Rotate is always a multiple of 90,
// clockwise). A page's own reported rotation can technically be any integer -- normalizeAngle
// folds it into this set the same way viewers do.
type PageAngle = 0 | 90 | 180 | 270;
function normalizeAngle(angle: number): PageAngle {
  const wrapped = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return wrapped as PageAngle;
}

// Maps a point (u, v) in the source page's CROP-BOX-relative, unrotated coordinate space
// (u in [0, cropWidth], v in [0, cropHeight], exactly the local space pdf-lib's embedPage
// produces) to its position on the new footer-bearing page, for a source page whose /Rotate
// is `angle` degrees clockwise. Derived once analytically per case (not guessed): each case
// solves "where do the crop box's four corners land after the same clockwise rotation the
// original page's own /Rotate already told every viewer to apply", so the copy displays
// identically to the source, just with footerHeight of new, guaranteed-blank space added on
// what is the visual bottom edge in every case.
function transformPoint(u: number, v: number, angle: PageAngle, cropWidth: number, cropHeight: number, footerHeight: number): [number, number] {
  switch (angle) {
    case 0: return [u, v + footerHeight];
    case 90: return [v, cropWidth + footerHeight - u];
    case 180: return [cropWidth - u, footerHeight + cropHeight - v];
    case 270: return [cropHeight - v, footerHeight + u];
  }
}

// The drawPage() placement (anchor + rotate) that reproduces the same corner mapping as
// transformPoint above, so the visible content and the annotation geometry (transformed
// separately below, since embedPage never carries annotations) end up in agreement.
function footerPagePlacement(angle: PageAngle, cropWidth: number, cropHeight: number, footerHeight: number) {
  switch (angle) {
    case 0: return { x: 0, y: footerHeight, rotate: degrees(0), pageWidth: cropWidth, pageHeight: cropHeight + footerHeight };
    case 90: return { x: 0, y: cropWidth + footerHeight, rotate: degrees(270), pageWidth: cropHeight, pageHeight: cropWidth + footerHeight };
    case 180: return { x: cropWidth, y: footerHeight + cropHeight, rotate: degrees(180), pageWidth: cropWidth, pageHeight: cropHeight + footerHeight };
    case 270: return { x: cropHeight, y: footerHeight, rotate: degrees(90), pageWidth: cropHeight, pageHeight: cropWidth + footerHeight };
  }
}

function transformCoordinatePairs(array: PDFArray | undefined, cropX: number, cropY: number, angle: PageAngle, cropWidth: number, cropHeight: number, footerHeight: number, reorderAsRect = false) {
  if (!array) return;
  const points: [number, number][] = [];
  for (let index = 0; index + 1 < array.size(); index += 2) {
    const x = array.lookup(index, PDFNumber);
    const y = array.lookup(index + 1, PDFNumber);
    if (!x || !y) { points.push([NaN, NaN]); continue; }
    points.push(transformPoint(x.asNumber() - cropX, y.asNumber() - cropY, angle, cropWidth, cropHeight, footerHeight));
  }
  // /Rect specifically must stay in [llx, lly, urx, ury] order (lower-left, upper-right) for
  // viewers to treat it as a valid box -- a rotation can swap which transformed corner ends up
  // lower/upper, left/right, so re-sort into that canonical order. /L, /Vertices, /CL and
  // /InkList are point *paths*, not boxes; their point order carries meaning and must not be
  // reordered, only transformed in place.
  const ordered = reorderAsRect && points.length === 2
    ? [[Math.min(points[0]![0], points[1]![0]), Math.min(points[0]![1], points[1]![1])], [Math.max(points[0]![0], points[1]![0]), Math.max(points[0]![1], points[1]![1])]]
    : points;
  ordered.forEach(([x, y], pointIndex) => {
    array.set(pointIndex * 2, PDFNumber.of(x!));
    array.set(pointIndex * 2 + 1, PDFNumber.of(y!));
  });
}

// /InkList is an array of arrays (one stroke per sub-array), each holding its own x y x y ...
// coordinate pairs, so it needs one level of unwrapping before transformCoordinatePairs applies.
function transformInkList(array: PDFArray | undefined, cropX: number, cropY: number, angle: PageAngle, cropWidth: number, cropHeight: number, footerHeight: number) {
  if (!array) return;
  for (let index = 0; index < array.size(); index += 1) {
    transformCoordinatePairs(array.lookup(index, PDFArray), cropX, cropY, angle, cropWidth, cropHeight, footerHeight);
  }
}

// A pure-rotation PDF content matrix [a b c d e f] for the same clockwise `angle` used
// elsewhere in this file, in row-vector form (x' = a*x + c*y, y' = b*x + d*y). No-op for 0.
const ROTATION_MATRIX: Record<PageAngle, [number, number, number, number, number, number]> = {
  0: [1, 0, 0, 1, 0, 0],
  90: [0, -1, 1, 0, 0, 0],
  180: [-1, 0, 0, -1, 0, 0],
  270: [0, 1, -1, 0, 0, 0],
};

function composeMatrix(m1: readonly number[], m2: readonly number[]): [number, number, number, number, number, number] {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2] = m2;
  return [a1! * a2! + b1! * c2!, a1! * b2! + b1! * d2!, c1! * a2! + d1! * c2!, c1! * b2! + d1! * d2!, e1! * a2! + f1! * c2!, e1! * b2! + f1! * d2!];
}

// A rotated page's content is placed via drawPage's own rotate option, but an annotation's
// cached /AP normal appearance stream is a self-contained Form XObject the viewer maps into
// /Rect using ITS OWN Matrix (PDF 32000-1 §12.5.5) -- transformCoordinatePairs moving /Rect
// alone never touches that. Left untouched, a 90/270 rotation swaps the transformed Rect's
// width/height while the appearance's own transformed bounding box keeps its original aspect
// ratio, so the viewer's box-to-Rect fit stretches it non-uniformly; at 180 the content simply
// renders in its original (now upside-down relative to the page) orientation. Composing the
// same rotation into the appearance's own Matrix keeps its transformed bounding box in step
// with the rotated Rect, so the fit stays undistorted and correctly oriented.
function rotateAnnotationAppearance(annotation: PDFDict, angle: PageAngle) {
  if (angle === 0) return;
  const apDict = annotation.lookupMaybe(PDFName.of("AP"), PDFDict);
  const normal = apDict?.lookupMaybe(PDFName.of("N"), PDFStream);
  // A stateful annotation (checkbox, radio button) has /AP /N pointing at a sub-dictionary of
  // named appearance streams instead of a single stream -- rare on evidence PDFs and left
  // untouched rather than guessed at.
  if (!normal) return;
  const existing = normal.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
  const existingValues = existing ? Array.from({ length: 6 }, (_, index) => existing.lookup(index, PDFNumber)?.asNumber() ?? [1, 0, 0, 1, 0, 0][index]!) : [1, 0, 0, 1, 0, 0];
  const composed = composeMatrix(existingValues, ROTATION_MATRIX[angle]);
  normal.dict.set(PDFName.of("Matrix"), normal.dict.context.obj(composed));
}

/**
 * Copies one page of an imported PDF onto `output` with room for a footer, WITHOUT ever
 * risking exposure of content the source PDF cropped out of view. The earlier approach grew
 * the copied page's own boxes and translated its content stream in place; because a page's
 * CropBox can legitimately sit inside its MediaBox (exactly how a producer hides content
 * without deleting it), that in-place growth could pull up to footerHeight of that
 * deliberately-hidden strip back into the visible window -- confirmed by working through the
 * geometry: growing CropBox height while holding its lower edge fixed, combined with shifting
 * content up by the same amount, exposes precisely the band between (crop.y - footerHeight)
 * and crop.y that was previously below the visible window.
 *
 * This version never modifies the source page's own coordinate space at all. It embeds the
 * page as a Form XObject clipped to exactly its CropBox (pdf-lib's embedPage — a PDF Form
 * XObject's /BBox is a hard clip every conforming renderer must honor, so nothing outside the
 * crop is ever visible), then draws that clipped embed onto a brand-new page whose entire
 * coordinate space never had any content in it before -- the footer strip is guaranteed-blank
 * space, not reclaimed space. Annotations aren't carried by embedPage (it only captures the
 * content stream), so they're copied and transformed separately via transformCoordinatePairs,
 * using the exact same corner mapping the visible content itself was placed with.
 */
async function copyImportedPageWithFooter(output: PDFDocument, source: PDFDocument, pageIndex: number, footerHeight = IMPORTED_PAGE_FOOTER_HEIGHT): Promise<PDFPage> {
  const [sourcePage] = await output.copyPages(source, [pageIndex]);
  if (!sourcePage) throw new Error(`PDF page ${pageIndex + 1} could not be copied.`);
  // embedPage requires a /Contents entry to exist; a page with literally nothing drawn on it
  // (a blank divider page, or a bare synthetic PDFDocument.addPage() with no draw calls) has
  // none. Forcing an empty content stream is a true no-op -- it adds zero operators -- and
  // keeps a genuinely blank source page exportable instead of falling into the "could not be
  // included" notice path.
  sourcePage.pushOperators();
  const crop = sourcePage.getCropBox();
  const angle = normalizeAngle(sourcePage.getRotation().angle);
  const embedded = await output.embedPage(sourcePage, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height });
  const placement = footerPagePlacement(angle, crop.width, crop.height, footerHeight);
  const page = output.addPage([placement.pageWidth, placement.pageHeight]);
  page.drawPage(embedded, { x: placement.x, y: placement.y, width: crop.width, height: crop.height, rotate: placement.rotate });

  // /UserUnit scales MediaBox/CropBox units into physical measurements (used for large-format
  // sources like architectural scans); a fresh addPage() always defaults to 1. Propagating the
  // source's value keeps the new page's physical size correct -- since none of the box numbers
  // above are rescaled, only repositioned/rotated, copying it verbatim is sufficient.
  const userUnit = sourcePage.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber);
  if (userUnit) page.node.set(PDFName.of("UserUnit"), userUnit);
  // A page-level /Group (an isolated/knockout transparency group) affects how semi-transparent
  // content composites; propagate it to the replacement page so that compositing doesn't
  // silently change even though it isn't fully equivalent to a group scoped to just the
  // embedded content -- pdf-lib's embedPage doesn't expose a hook to add /Group to the Form
  // XObject it creates directly.
  const group = sourcePage.node.get(PDFName.of("Group"));
  if (group) page.node.set(PDFName.of("Group"), group);

  const annotations = sourcePage.node.Annots();
  if (annotations) {
    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = annotations.lookup(index, PDFDict);
      if (!annotation) continue;
      // lookupMaybe, not lookup: these keys are optional on any given annotation subtype (a
      // Link has no /L, a Line has no /Rect on some producers' output), and the typed lookup()
      // throws rather than returning undefined when a key is simply absent. lookupMaybe is the
      // variant that tolerates that.
      transformCoordinatePairs(annotation.lookupMaybe(PDFName.of("Rect"), PDFArray), crop.x, crop.y, angle, crop.width, crop.height, footerHeight, true);
      transformCoordinatePairs(annotation.lookupMaybe(PDFName.of("QuadPoints"), PDFArray), crop.x, crop.y, angle, crop.width, crop.height, footerHeight);
      transformCoordinatePairs(annotation.lookupMaybe(PDFName.of("L"), PDFArray), crop.x, crop.y, angle, crop.width, crop.height, footerHeight);
      transformCoordinatePairs(annotation.lookupMaybe(PDFName.of("Vertices"), PDFArray), crop.x, crop.y, angle, crop.width, crop.height, footerHeight);
      transformCoordinatePairs(annotation.lookupMaybe(PDFName.of("CL"), PDFArray), crop.x, crop.y, angle, crop.width, crop.height, footerHeight);
      transformInkList(annotation.lookupMaybe(PDFName.of("InkList"), PDFArray), crop.x, crop.y, angle, crop.width, crop.height, footerHeight);
      rotateAnnotationAppearance(annotation, angle);
    }
    page.node.set(PDFName.of("Annots"), annotations);
  }
  return page;
}

// A title/filename PII finding marked "remove" is never flattened into a page image (there
// is no page) — it is removed by substituting the matched text wherever the field is
// rendered, in both export artifacts (PDF and JSON manifest). The stored item.title itself
// is never mutated, exactly like a PDF page's underlying bytes are never mutated for a
// body-finding removal — only what gets rendered into an export changes.
function redactedTitle(item: EvidenceItem): string {
  return redactText(item.title, item.privacyFindings ?? []);
}
function redactedFileName(item: EvidenceItem): string | undefined {
  return item.originalFileName ? redactText(item.originalFileName, item.privacyFindings ?? []) : item.originalFileName;
}
// A note's body text has no page/coordinates to flatten the way a PDF page does, so its only
// possible redaction is the same substring-replace title/filename already use. Only "body"
// findings apply here -- a title finding whose value happens to also appear in the note body
// is a coincidence, not a decision the reviewer made about the body text.
function redactedBody(item: EvidenceItem, text: string): string {
  return redactText(text, (item.privacyFindings ?? []).filter((finding) => (finding.field ?? "body") === "body"));
}

// The keyhole mark, drawn as vector shapes rather than an embedded image so the
// cover page never depends on a raster asset. Coordinates match the 96x96 mark used
// everywhere else in the product (extension icon, workspace topbar). The two-page
// overlap effect used at larger sizes is skipped here — at stamp size on a printed
// page the ±6deg rotation just reads as blur, so this is the single-rect simplification.
function drawMark(page: PDFPage, x: number, y: number, size: number, ink: Color, paper: Color) {
  const opts = { x, y, scale: size / 96 };
  page.drawSvgPath("M34 18 H66 A10 10 0 0 1 76 28 V72 A10 10 0 0 1 66 82 H34 A10 10 0 0 1 24 72 V28 A10 10 0 0 1 34 18 Z", { ...opts, color: ink });
  page.drawSvgPath("M41 44 A9 9 0 1 1 59 44 A9 9 0 1 1 41 44 Z", { ...opts, color: paper });
  page.drawSvgPath("M49 50 H51 A3 3 0 0 1 54 53 V65 A3 3 0 0 1 51 68 H49 A3 3 0 0 1 46 65 V53 A3 3 0 0 1 49 50 Z", { ...opts, color: paper });
}

// Shown verbatim in the manifest whenever at least one item carries provenance, so a reader
// of the JSON alone — not just someone reading source or SPEC.md — sees the same warning the
// PDF export and the interchange contract both make: a hash proves bytes weren't altered
// relative to what was hashed, never who sent them or that their content is true. See
// packages/evidence-interchange/SPEC.md sections 5 and 13 for the full reasoning this
// summarises; this notice must stay consistent with that document, not drift from it.
const PRODUCER_IDENTITY_NOTICE =
  "One or more items in this pack were supplied by an external producer via Tracepack's " +
  "evidence interchange format (see \"provenance\" on each such item below). The producer's " +
  "identity is self-asserted and not cryptographically verified by Tracepack. contentHash " +
  "and any integrity hash on the original payload prove the bytes were not altered relative " +
  "to what was hashed — they do not prove who sent them, and they do not prove that any " +
  "\"observations\" claim is true. An item with sourceType \"note\" and provenance set is a " +
  "Tracepack-generated rendering of the producer's reported claims, not an original document " +
  "the producer supplied — its hash proves that rendering is intact, not that any external " +
  "artifact existed.";

export function buildManifest(project: TracepackProject) {
  const included = project.evidence.filter((item) => item.reviewStatus !== "excluded");
  return {
    format: "tracepack-source-manifest",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title, templateId: project.template.id, templateVersion: project.template.version },
    producerIdentityNotice: included.some((item) => item.provenance) ? PRODUCER_IDENTITY_NOTICE : null,
    evidence: included.map((item) => ({
      id: item.id,
      title: redactedTitle(item),
      categoryId: item.categoryId,
      sourceType: item.sourceType,
      originalFileName: redactedFileName(item) ?? null,
      sourceUrl: item.sourceUrl ?? null,
      importedAt: item.importedAt,
      eventDate: item.eventDate ?? null,
      contentHash: item.contentHash,
      reviewStatus: item.reviewStatus,
      provenance: item.provenance ?? null,
      observations: item.observations ?? [],
    })),
  };
}

export function downloadJson(project: TracepackProject) {
  const blob = new Blob([JSON.stringify(buildManifest(project), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-manifest.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeName(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function wrap(text: string, width = 80) { const words = text.split(/\s+/); const lines: string[] = []; let line = ""; for (const word of words) { const next = line ? `${line} ${word}` : word; if (next.length > width) { if (line) lines.push(line); line = word; } else line = next; } if (line) lines.push(line); return lines; }

// Observations arrive from an external producer (packages/evidence-interchange) and are
// never independently verified by Tracepack — they get their own clearly attributed page,
// never folded into the item's own content or worded as a Tracepack finding. This is the
// export-side half of the trust boundary described in evidence-interchange/SPEC.md section 4.
function drawObservationsPage(output: PDFDocument, item: EvidenceItem, regular: PDFFont, bold: PDFFont) {
  const observations = item.observations;
  if (!observations?.length || !item.provenance) return;
  const producer = `${item.provenance.producerName}${item.provenance.producerVersion ? ` v${item.provenance.producerVersion}` : ""}`;
  let page = output.addPage([595, 842]);
  page.drawText("External observations", { x: 54, y: 790, size: 14, font: bold });
  page.drawText(`Reported by ${producer}. Not independently verified by Tracepack.`, { x: 54, y: 770, size: 9, font: regular, color: rgb(0.4, 0.44, 0.42) });
  let y = 736;
  for (const observation of observations) {
    if (y < 90) { page = output.addPage([595, 842]); y = 790; }
    page.drawText(`Producer observation: ${observation.label}`.slice(0, 80), { x: 54, y, size: 11, font: bold }); y -= 16;
    for (const line of wrap(observation.detail, 82)) {
      if (y < 60) { page = output.addPage([595, 842]); y = 790; }
      page.drawText(line, { x: 54, y, size: 9.5, font: regular }); y -= 13;
    }
    if (observation.confidence !== undefined) { page.drawText(`Producer-reported confidence: ${observation.confidence}`, { x: 54, y, size: 8.5, font: regular, color: rgb(0.5, 0.54, 0.52) }); y -= 13; }
    y -= 12;
  }
}

// pdf-lib can only embed PNG/JPEG, so WebP evidence is decoded via canvas and
// re-encoded as PNG before embedding rather than being dropped from the pack.
async function convertWebpToPng(blob: Blob): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("WebP conversion canvas is unavailable.");
      context.drawImage(bitmap, 0, 0);
      const pngBlob = await canvas.convertToBlob({ type: "image/png" });
      return await pngBlob.arrayBuffer();
    }
    if (typeof document === "undefined") throw new Error("WebP conversion requires a browser canvas.");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("WebP conversion canvas is unavailable.");
    context.drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("WebP conversion failed.")), "image/png"));
    return await pngBlob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

export async function flattenImageRedactions(source: Blob, regions: ManualImageRedaction[]): Promise<RasterizedPage> {
  if (regions.some((region) => region.decision === "unreviewed")) {
    throw new Error("Manual image redactions must be reviewed before export.");
  }
  const removals = regions.filter((region) => region.decision === "remove");
  const bitmap = await createImageBitmap(source);
  try {
    if (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") throw new Error("Secure image redaction requires a browser canvas.");
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    // Preserve the source alpha channel. Forcing an opaque canvas without first painting a
    // background turns every transparent pixel black, not just the selected redaction boxes.
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Secure image redaction canvas is unavailable.");
    context.drawImage(bitmap, 0, 0);
    context.fillStyle = "#000000";
    for (const region of removals) {
      context.fillRect(
        Math.max(0, region.x) * bitmap.width,
        Math.max(0, region.y) * bitmap.height,
        Math.min(1 - region.x, region.width) * bitmap.width,
        Math.min(1 - region.y, region.height) * bitmap.height,
      );
    }
    const flattened = "convertToBlob" in canvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob: Blob | null) => blob ? resolve(blob) : reject(new Error("The redacted image could not be flattened.")), "image/png"));
    return { bytes: await flattened.arrayBuffer(), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export interface RasterizedPage { bytes: ArrayBuffer; width: number; height: number }
export type PdfRasterizer = (source: Blob, pageNumber: number, findings: PrivacyFinding[], manualRegions?: ManualImageRedaction[]) => Promise<RasterizedPage>;

function isValidNormalisedPdfRegion(region: ManualImageRedaction) {
  const coordinates = [region.x, region.y, region.width, region.height];
  return coordinates.every(Number.isFinite)
    && region.x >= 0 && region.x < 1
    && region.y >= 0 && region.y < 1
    && region.width > 0 && region.height > 0
    && Math.min(1, region.x + region.width) > region.x
    && Math.min(1, region.y + region.height) > region.y;
}

export const rasterizeRedactedPage: PdfRasterizer = async (source, pageNumber, findings, manualRegions = []) => {
  if (typeof document === "undefined") throw new Error("Secure redaction requires a browser canvas.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await source.arrayBuffer()) }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Secure redaction canvas is unavailable.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  context.fillStyle = "#000000";
  for (const finding of findings) {
    if (!finding.location) continue;
    const { x, y, width, height } = finding.location;
    const [left, bottom, right, top] = viewport.convertToViewportRectangle([x - 2, y - 2, x + width + 2, y + height + 2]);
    context.fillRect(Math.min(left, right), Math.min(bottom, top), Math.abs(right - left), Math.abs(top - bottom));
  }
  for (const region of manualRegions) {
    context.fillRect(
      Math.max(0, region.x) * canvas.width,
      Math.max(0, region.y) * canvas.height,
      Math.min(1 - region.x, region.width) * canvas.width,
      Math.min(1 - region.y, region.height) * canvas.height,
    );
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("The redacted page could not be flattened.")), "image/jpeg", 0.92));
  return { bytes: await blob.arrayBuffer(), width: viewport.width / 2, height: viewport.height / 2 };
};

export async function buildEvidencePack(project: TracepackProject, files: Map<string, Blob>, rasterizer: PdfRasterizer = rasterizeRedactedPage) {
  const includedPdfRegions = project.evidence
    .filter((item) => item.reviewStatus !== "excluded")
    .flatMap((item) => item.manualRedactions ?? [])
    .filter((region) => region.kind === "pdf-region");
  const invalidPdfPages = includedPdfRegions.filter((region) => !Number.isInteger(region.pageNumber) || (region.pageNumber ?? 0) < 1);
  if (invalidPdfPages.length > 0) {
    throw new Error(`Choose a PDF page for ${invalidPdfPages.length} manual redaction${invalidPdfPages.length === 1 ? "" : "s"} before export.`);
  }
  const invalidPdfRectangles = includedPdfRegions.filter((region) => region.decision === "remove" && !isValidNormalisedPdfRegion(region));
  if (invalidPdfRectangles.length > 0) {
    throw new Error(`Redraw ${invalidPdfRectangles.length} invalid PDF redaction region${invalidPdfRectangles.length === 1 ? "" : "s"} before export.`);
  }
  for (const item of project.evidence.filter((entry) => entry.reviewStatus !== "excluded" && entry.sourceType === "pdf")) {
    const manualRemovals = (item.manualRedactions ?? []).filter((region) => region.kind === "pdf-region" && region.decision === "remove");
    const blob = files.get(item.id);
    if (manualRemovals.length === 0 || !blob) continue;
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
    } catch {
      // Unreadable PDFs are handled later with a visible omission page. The range check can
      // only be performed when the source document itself can be opened.
      continue;
    }
    const pageCount = source.getPageCount();
    const outsideDocument = manualRemovals.filter((region) => (region.pageNumber ?? 0) > pageCount);
    if (outsideDocument.length > 0) {
      throw new Error(`A manual PDF redaction targets a page outside the ${pageCount}-page document.`);
    }
  }
  const unresolvedManual = project.evidence.filter((item) => item.reviewStatus !== "excluded").flatMap((item) => item.manualRedactions ?? []).filter((region) => region.decision === "unreviewed");
  if (unresolvedManual.length > 0) throw new Error(`Review ${unresolvedManual.length} manual image redaction${unresolvedManual.length === 1 ? "" : "s"} before export.`);
  const output = await PDFDocument.create(); const regular = await output.embedFont(StandardFonts.Helvetica); const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const included = project.evidence.filter((item) => item.reviewStatus !== "excluded");
  const cover = output.addPage([595, 842]);
  drawMark(cover, 54, 787, 16, rgb(0.114, 0.235, 0.176), rgb(1, 0.996, 0.976));
  cover.drawText("TRACEPACK", { x: 76, y: 774, size: 12, font: bold, color: rgb(0.12, 0.35, 0.25) });
  cover.drawText(project.title.slice(0, 62), { x: 54, y: 712, size: 27, font: bold }); let y = 674;
  for (const line of wrap(project.summary || "Structured evidence pack", 70)) { cover.drawText(line, { x: 54, y, size: 11, font: regular }); y -= 17; }
  cover.drawText(`Organisation: ${project.organisation || "Not specified"}`, { x: 54, y: y - 20, size: 10, font: regular });
  cover.drawText(`Generated locally: ${new Date().toLocaleDateString()}`, { x: 54, y: y - 38, size: 10, font: regular });
  cover.drawText(`${included.length} evidence item${included.length === 1 ? "" : "s"}`, { x: 54, y: y - 56, size: 10, font: bold });
  const index = output.addPage([595, 842]); index.drawText("Evidence index", { x: 54, y: 780, size: 22, font: bold }); y = 744;
  included.forEach((item, i) => { if (y < 70) return; const category = project.template.categories.find((c) => c.id === item.categoryId)?.name ?? "Other"; index.drawText(`${i + 1}. ${redactedTitle(item)}`.slice(0, 74), { x: 54, y, size: 11, font: bold }); index.drawText(`${category} | ${item.eventDate || "No event date"} | SHA-256 ${item.contentHash.slice(0, 16)}...`, { x: 68, y: y - 16, size: 8, font: regular }); y -= 48; });
  for (const item of included) { const blob = files.get(item.id); if (!blob) continue;
    if (item.sourceType === "pdf") {
      // A stored "pdf" item can be unreadable as a PDF (e.g. imported already-corrupted, or
      // truncated by a failed download) even though document-engine accepted it at import time
      // with textExtractionStatus "failed" — inspectPdf tolerates that per-item, but pdf-lib's
      // load here does not. Without this catch, one bad file throws out of the loop and aborts
      // the whole pack for every other item, with a raw parser error as the only feedback.
      try {
        const source = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
        const removals = (item.privacyFindings ?? []).filter((finding) => finding.decision === "remove" && finding.location);
        const manualRemovals = (item.manualRedactions ?? []).filter((region) => region.kind === "pdf-region" && region.decision === "remove");
        for (const pageIndex of source.getPageIndices()) {
          const pageNumber = pageIndex + 1;
          const pageFindings = removals.filter((finding) => finding.location?.pageNumber === pageNumber);
          const pageManualRegions = manualRemovals.filter((region) => region.pageNumber === pageNumber);
          if (pageFindings.length === 0 && pageManualRegions.length === 0) {
            await copyImportedPageWithFooter(output, source, pageIndex);
            continue;
          }
          const flattened = await rasterizer(blob, pageNumber, pageFindings, pageManualRegions);
          const image = await output.embedJpg(flattened.bytes);
          const page = output.addPage([flattened.width, flattened.height + 46]);
          page.drawImage(image, { x: 0, y: 46, width: flattened.width, height: flattened.height });
        }
      } catch (cause) {
        const notice = output.addPage([595, 842]);
        notice.drawText(redactedTitle(item).slice(0, 74), { x: 54, y: 780, size: 14, font: bold });
        notice.drawText("This item could not be included in the export.", { x: 54, y: 750, size: 11, font: bold, color: rgb(0.62, 0.21, 0.17) });
        let noticeY = 726;
        for (const line of wrap(`The stored file for "${redactedTitle(item)}" could not be read as a PDF and was skipped: ${cause instanceof Error ? cause.message : String(cause)}`, 82)) {
          notice.drawText(line, { x: 54, y: noticeY, size: 9.5, font: regular }); noticeY -= 14;
        }
      }
    }
    else if (item.sourceType === "image" || item.sourceType === "webpage") {
      const regions = item.manualRedactions ?? [];
      const flattened = regions.some((region) => region.decision === "remove")
        ? await flattenImageRedactions(blob, regions)
        : undefined;
      const isWebp = item.mimeType === "image/webp";
      const bytes = flattened?.bytes ?? (isWebp ? await convertWebpToPng(blob) : await blob.arrayBuffer());
      const image = flattened || item.mimeType === "image/png" || isWebp ? await output.embedPng(bytes) : await output.embedJpg(bytes);
      const page = output.addPage([595, 842]);
      page.drawRectangle({ x: 36, y: 38, width: 523, height: 766, color: rgb(1, 0.996, 0.976), borderColor: rgb(0.85, 0.87, 0.84), borderWidth: 1 });
      page.drawText(redactedTitle(item).slice(0, 68), { x: 54, y: 770, size: 14, font: bold, color: rgb(0.09, 0.14, 0.11) });
      const category = project.template.categories.find((entry) => entry.id === item.categoryId)?.name ?? "Other";
      page.drawText(category.toUpperCase(), { x: 54, y: 749, size: 8, font: bold, color: rgb(0.12, 0.35, 0.25) });
      const scaled = image.scaleToFit(487, 640);
      const imageX = (595 - scaled.width) / 2; const imageY = 82 + (640 - scaled.height) / 2;
      page.drawRectangle({ x: imageX - 5, y: imageY - 5, width: scaled.width + 10, height: scaled.height + 10, color: rgb(0.96, 0.96, 0.93) });
      page.drawImage(image, { x: imageX, y: imageY, width: scaled.width, height: scaled.height });
      if (regions.some((region) => region.decision === "remove")) page.drawText("Manual redactions flattened into this export copy", { x: 54, y: 58, size: 8, font: regular, color: rgb(0.4, 0.44, 0.42) });
    }
    else if (item.sourceType === "note") {
      const text = redactedBody(item, await blob.text());
      let notePage = output.addPage([595, 842]);
      notePage.drawText(redactedTitle(item).slice(0, 74), { x: 54, y: 780, size: 14, font: bold });
      let noteY = 748;
      for (const line of wrap(text, 82)) {
        if (noteY < 60) { notePage = output.addPage([595, 842]); noteY = 780; }
        notePage.drawText(line, { x: 54, y: noteY, size: 10, font: regular });
        noteY -= 15;
      }
    }
    // sourceType is an open string (a template can accept a kind this engine has never heard
    // of), but only pdf/image/webpage/note have real rendering above. Without this branch, an
    // item of any other kind would silently vanish from the export -- present in the cover
    // page's item count and the evidence index, absent from the actual pack, with no notice
    // anywhere. This mirrors the corrupted-PDF notice above: say so on a page, never drop it.
    else {
      const notice = output.addPage([595, 842]);
      notice.drawText(redactedTitle(item).slice(0, 74), { x: 54, y: 780, size: 14, font: bold });
      notice.drawText("This item could not be included in the export.", { x: 54, y: 750, size: 11, font: bold, color: rgb(0.62, 0.21, 0.17) });
      let noticeY = 726;
      for (const line of wrap(`Tracepack does not yet know how to render evidence of type "${item.sourceType}" into this PDF pack. The original file is still stored and included in the .tracepack bundle and JSON manifest.`, 82)) {
        notice.drawText(line, { x: 54, y: noticeY, size: 9.5, font: regular }); noticeY -= 14;
      }
    }
    drawObservationsPage(output, item, regular, bold);
  }
  const pages = output.getPages();
  pages.forEach((page, index) => {
    if (index === 0) return;
    // Positioned from each page's own width, not a hardcoded 595pt assumption -- an imported
    // PDF page can be any size (a scanned receipt, a landscape document), and a fixed x=541/475
    // right margin would land outside a narrower page's visible area entirely.
    const width = page.getWidth();
    const margin = Math.min(54, width / 8);
    page.drawLine({ start: { x: margin, y: 34 }, end: { x: width - margin, y: 34 }, thickness: 0.5, color: rgb(0.82, 0.84, 0.81) });
    const label = `Page ${index + 1} of ${pages.length}`;
    const labelWidth = regular.widthOfTextAtSize(label, 7.5);
    // Truncated to the space actually left after the right-aligned page-number label, not a
    // flat 48-character guess -- a receipt-width page leaves far less room than a 595pt one,
    // and a long title would otherwise run straight through the page number.
    const titleBudget = Math.max(0, width - margin * 2 - labelWidth - 12);
    let title = project.title;
    while (title.length > 0 && regular.widthOfTextAtSize(title, 7.5) > titleBudget) title = title.slice(0, -1);
    page.drawText(title, { x: margin, y: 20, size: 7.5, font: regular, color: rgb(0.42, 0.46, 0.43) });
    page.drawText(label, { x: width - margin - labelWidth, y: 20, size: 7.5, font: regular, color: rgb(0.42, 0.46, 0.43) });
  });
  const bytes = await output.save();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
}

export async function downloadEvidencePack(project: TracepackProject, files: Map<string, Blob>) { const blob = await buildEvidencePack(project, files); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${safeName(project.title) || "tracepack"}-evidence-pack.pdf`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

/**
 * A .tracepack file is a ZIP archive bundling exactly the two things
 * downloadEvidencePack/downloadJson already produce separately — the PDF evidence pack and
 * the JSON manifest — as one file. It is deliberately NOT a bundle of raw original attachment
 * bytes: buildEvidencePack's redaction (rasterizeRedactedPage, title/filename substitution)
 * only ever applies to the rendered PDF, and re-deriving equivalent redaction for a
 * separately-bundled set of raw files is a distinct, harder problem that hasn't been solved
 * here — doing it carelessly would risk re-exposing PII a reviewer explicitly approved for
 * removal. Bundling verbatim raw attachments is future work, not this function's job.
 *
 * PDF bytes are stored uncompressed (level: 0) since PDF is already a compressed format —
 * re-compressing it wastes time for no size benefit, the same guidance fflate's own docs give.
 */
export async function buildTracepackBundle(project: TracepackProject, files: Map<string, Blob>, rasterizer: PdfRasterizer = rasterizeRedactedPage): Promise<Blob> {
  const pdfBlob = await buildEvidencePack(project, files, rasterizer);
  const manifestJson = JSON.stringify(buildManifest(project), null, 2);
  const zipped = zipSync({
    "manifest.json": strToU8(manifestJson),
    "evidence-pack.pdf": [new Uint8Array(await pdfBlob.arrayBuffer()), { level: 0 }],
  });
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: "application/octet-stream" });
}

export async function downloadTracepackBundle(project: TracepackProject, files: Map<string, Blob>) {
  const blob = await buildTracepackBundle(project, files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeName(project.title) || "tracepack"}.tracepack`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EPACK_SPEC_VERSION = "1.0";

interface EpackEmbeddedArtifact {
  type: "embedded";
  path: string;
  digest: string;
  size: number;
  content_type: string;
  display_name: string;
  collected_at: string;
}

interface EpackManifest {
  spec_version: typeof EPACK_SPEC_VERSION;
  stream: string;
  generated_at: string;
  pack_digest: string;
  sources: never[];
  artifacts: EpackEmbeddedArtifact[];
}

// The Evidence Pack v1 spec requires "YYYY-MM-DDTHH:MM:SSZ" -- no fractional seconds. This
// repo's usual `new Date().toISOString()` includes milliseconds (".sssZ"), so that alone
// would not conform.
function epackTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Reproduces the pack_digest algorithm from locktivity/evidence-pack's spec/v1/pack.md
// section 5.1.1 exactly: canonical UTF-8 text built as "{path}\t{digest}\n" per embedded
// artifact, sorted byte-wise lexicographically (not locale-aware), concatenated with no extra
// trailing newline, then SHA-256'd. This has to reproduce their algorithm bit-for-bit, not
// just "a" hash -- a Tracepack-produced .epack that doesn't compute pack_digest exactly this
// way would fail verification against real evidence-pack tooling, defeating the point of
// using their format. JS's default string sort (UTF-16 code unit order) is byte-equivalent to
// UTF-8 byte order here specifically because paths and hex digests are always plain ASCII --
// this would need real UTF-8-byte sorting if either ever carried non-ASCII text.
async function computeEpackPackDigest(artifacts: Array<{ path: string; digest: string }>): Promise<string> {
  const lines = artifacts.map((artifact) => `${artifact.path}\t${artifact.digest}\n`).sort();
  return `sha256:${await sha256Hex(lines.join(""))}`;
}

/**
 * Builds a .epack archive conforming to the Evidence Pack v1 container format
 * (github.com/locktivity/evidence-pack, spec/v1/pack.md) -- a format originally designed for
 * software supply-chain security evidence (SBOMs, CI attestations), reused here so a Tracepack
 * export can be opened by any evidence-pack-compatible tool, not just Tracepack's own.
 *
 * Deliberately embeds exactly one artifact: the same redacted, flattened PDF
 * buildEvidencePack/buildTracepackBundle already produce -- never the raw original attachment
 * files. The spec's artifacts/ folder is meant for the underlying evidence files, but bundling
 * Tracepack's raw originals would put back exactly the PII a human reviewer approved for
 * removal (see buildTracepackBundle's comment above, same reasoning). Redaction here only ever
 * exists in the rendered PDF, so that is the only artifact this can honestly embed today. No
 * attestations/ folder either, since Tracepack does not sign evidence yet -- see SECURITY.md.
 */
export async function buildEpackBundle(project: TracepackProject, files: Map<string, Blob>, rasterizer: PdfRasterizer = rasterizeRedactedPage): Promise<Blob> {
  const pdfBlob = await buildEvidencePack(project, files, rasterizer);
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const path = "artifacts/evidence-pack.pdf";
  const digest = `sha256:${await sha256Hex(pdfBytes)}`;

  const artifact: EpackEmbeddedArtifact = {
    type: "embedded",
    path,
    digest,
    size: pdfBytes.length,
    content_type: "application/pdf",
    display_name: `${project.title} -- evidence pack`,
    collected_at: epackTimestamp(new Date(project.updatedAt)),
  };

  const manifest: EpackManifest = {
    spec_version: EPACK_SPEC_VERSION,
    stream: project.id,
    generated_at: epackTimestamp(new Date()),
    pack_digest: await computeEpackPackDigest([{ path, digest }]),
    sources: [],
    artifacts: [artifact],
  };

  const zipped = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "artifacts/evidence-pack.pdf": [pdfBytes, { level: 0 }],
  });
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: "application/octet-stream" });
}

export async function downloadEpackBundle(project: TracepackProject, files: Map<string, Blob>) {
  const blob = await buildEpackBundle(project, files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeName(project.title) || "tracepack"}.epack`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
