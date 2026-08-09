import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildEpackBundle } from "../src/index";
import type { TracepackProject } from "@tracepack/evidence-core";

// Independently reimplements the Evidence Pack v1 pack_digest algorithm (spec/v1/pack.md
// section 5.1.1) using nothing from this package's own production code -- a genuine
// cross-check that the real implementation matches the spec, not just that it agrees with
// itself. Same reasoning as this repo's RFC 8785 test vectors: an implementation testing only
// its own output proves nothing about correctness.
async function referencePackDigest(entries: Array<{ path: string; digest: string }>): Promise<string> {
  const lines = entries.map((entry) => `${entry.path}\t${entry.digest}\n`).sort();
  const canonical = lines.join("");
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

async function sha256HexOf(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function baseProject(overrides: Partial<TracepackProject> = {}): TracepackProject {
  return {
    id: "p1", schemaVersion: 1, title: "Faulty kettle", organisation: "Example Retail",
    summary: "The kettle stopped working.", desiredResolution: "Refund",
    createdAt: "2026-01-01T00:00:00.123Z", updatedAt: "2026-01-02T09:30:15.456Z",
    template: { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
    evidence: [{
      id: "e1", projectId: "p1", title: "What happened", categoryId: "complaint_details", sourceType: "note",
      importedAt: "2026-01-01T00:00:00.000Z", contentHash: "b".repeat(64), reviewStatus: "reviewed", notes: "",
      size: 10, mimeType: "text/plain", extractedText: "The kettle stopped heating water.", textExtractionStatus: "complete",
    }],
    ...overrides,
  };
}

describe(".epack bundle (Evidence Pack v1 container format)", () => {
  it("zips exactly manifest.json and artifacts/evidence-pack.pdf, nothing else", async () => {
    const project = baseProject();
    const bundleBlob = await buildEpackBundle(project, new Map());
    const entries = unzipSync(new Uint8Array(await bundleBlob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(["artifacts/evidence-pack.pdf", "manifest.json"]);
  });

  it("produces a manifest matching the spec's required top-level shape", async () => {
    const project = baseProject();
    const bundleBlob = await buildEpackBundle(project, new Map());
    const entries = unzipSync(new Uint8Array(await bundleBlob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!));

    expect(manifest.spec_version).toBe("1.0");
    expect(manifest.stream).toBe(project.id);
    // "YYYY-MM-DDTHH:MM:SSZ" -- no fractional seconds, per spec section 2.x's timestamp rule.
    expect(manifest.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(manifest.sources).toEqual([]);
    expect(Array.isArray(manifest.artifacts)).toBe(true);
    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.pack_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("describes the embedded artifact correctly and its collected_at also has no fractional seconds", async () => {
    const project = baseProject();
    const bundleBlob = await buildEpackBundle(project, new Map());
    const entries = unzipSync(new Uint8Array(await bundleBlob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!));
    const artifact = manifest.artifacts[0];

    expect(artifact.type).toBe("embedded");
    expect(artifact.path).toBe("artifacts/evidence-pack.pdf");
    expect(artifact.content_type).toBe("application/pdf");
    expect(artifact.collected_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(artifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("the embedded artifact's digest matches the real bytes actually stored in the archive", async () => {
    const project = baseProject();
    const bundleBlob = await buildEpackBundle(project, new Map());
    const entries = unzipSync(new Uint8Array(await bundleBlob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!));
    const pdfBytes = entries["artifacts/evidence-pack.pdf"]!;

    const realDigest = `sha256:${await sha256HexOf(pdfBytes)}`;
    expect(manifest.artifacts[0].digest).toBe(realDigest);
  });

  it("pack_digest matches an independently reimplemented version of the spec's exact algorithm", async () => {
    const project = baseProject();
    const bundleBlob = await buildEpackBundle(project, new Map());
    const entries = unzipSync(new Uint8Array(await bundleBlob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!));
    const pdfBytes = entries["artifacts/evidence-pack.pdf"]!;

    const realDigest = `sha256:${await sha256HexOf(pdfBytes)}`;
    const expected = await referencePackDigest([{ path: "artifacts/evidence-pack.pdf", digest: realDigest }]);
    expect(manifest.pack_digest).toBe(expected);
  });

  it("never embeds raw, un-redacted attachment bytes -- only the already-redacted PDF and the manifest", async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([200, 200]);
    page.drawText("secret@example.com", { x: 20, y: 100, font, size: 12 });
    const sourceBlob = new Blob([await source.save()], { type: "application/pdf" });

    const project = baseProject({
      id: "p2", title: "Redaction test",
      evidence: [{
        id: "e1", projectId: "p2", title: "Private email", categoryId: "other", sourceType: "pdf", originalFileName: "private.pdf",
        importedAt: "2026-01-01T00:00:00.000Z", contentHash: "a".repeat(64), reviewStatus: "reviewed", notes: "",
        size: sourceBlob.size, mimeType: "application/pdf",
        privacyFindings: [{ id: "f1", kind: "email", label: "Email address", value: "secret@example.com", excerpt: "secret@example.com", decision: "remove", location: { pageNumber: 1, x: 20, y: 100, width: 110, height: 12 } }],
      }],
    });

    const onePixelJpeg = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q=="), (char) => char.charCodeAt(0));
    const bundleBlob = await buildEpackBundle(project, new Map([["e1", sourceBlob]]), async (_source, pageNumber, findings) => {
      expect(pageNumber === 1 && findings[0]?.value === "secret@example.com").toBe(true);
      return { bytes: onePixelJpeg.buffer, width: 200, height: 200 };
    });

    const zipped = new Uint8Array(await bundleBlob.arrayBuffer());
    const entries = unzipSync(zipped);
    expect(Object.keys(entries).sort()).toEqual(["artifacts/evidence-pack.pdf", "manifest.json"]);
    const wholeArchiveText = new TextDecoder().decode(zipped);
    expect(wholeArchiveText).not.toContain("secret@example.com");
  });

  it("the embedded PDF is a real, valid, correctly-built evidence pack", async () => {
    const project = baseProject();
    const bundleBlob = await buildEpackBundle(project, new Map());
    const entries = unzipSync(new Uint8Array(await bundleBlob.arrayBuffer()));
    const pdf = await PDFDocument.load(entries["artifacts/evidence-pack.pdf"]!);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });
});
