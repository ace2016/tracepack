import { redactText } from "@tracepack/document-engine";
import type { EvidenceItem, PrivacyFinding, TracepackProject } from "@tracepack/evidence-core";
import { sha256Hex } from "@tracepack/evidence-sdk";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type Color } from "pdf-lib";

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

export interface RasterizedPage { bytes: ArrayBuffer; width: number; height: number }
export type PdfRasterizer = (source: Blob, pageNumber: number, findings: PrivacyFinding[]) => Promise<RasterizedPage>;

export const rasterizeRedactedPage: PdfRasterizer = async (source, pageNumber, findings) => {
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
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("The redacted page could not be flattened.")), "image/jpeg", 0.92));
  const [viewX = 0, viewY = 0, viewRight = viewport.width / 2, viewTop = viewport.height / 2] = page.view;
  return { bytes: await blob.arrayBuffer(), width: viewRight - viewX, height: viewTop - viewY };
};

export async function buildEvidencePack(project: TracepackProject, files: Map<string, Blob>, rasterizer: PdfRasterizer = rasterizeRedactedPage) {
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
        for (const pageIndex of source.getPageIndices()) {
          const pageNumber = pageIndex + 1;
          const pageFindings = removals.filter((finding) => finding.location?.pageNumber === pageNumber);
          if (pageFindings.length === 0) { const [page] = await output.copyPages(source, [pageIndex]); output.addPage(page); continue; }
          const flattened = await rasterizer(blob, pageNumber, pageFindings);
          const image = await output.embedJpg(flattened.bytes);
          const page = output.addPage([flattened.width, flattened.height]);
          page.drawImage(image, { x: 0, y: 0, width: flattened.width, height: flattened.height });
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
    else if (item.sourceType === "image" || item.sourceType === "webpage") { const isWebp = item.mimeType === "image/webp"; const bytes = isWebp ? await convertWebpToPng(blob) : await blob.arrayBuffer(); const image = item.mimeType === "image/png" || isWebp ? await output.embedPng(bytes) : await output.embedJpg(bytes); const page = output.addPage([595, 842]); const scaled = image.scaleToFit(487, 700); page.drawText(redactedTitle(item).slice(0, 74), { x: 54, y: 790, size: 12, font: bold }); page.drawImage(image, { x: (595 - scaled.width) / 2, y: 60 + (700 - scaled.height) / 2, width: scaled.width, height: scaled.height }); }
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
