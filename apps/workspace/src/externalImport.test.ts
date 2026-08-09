import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceCategory, TemplateSnapshot, TracepackProject } from "@tracepack/evidence-core";
import { computePayloadHash, sha256Hex } from "@tracepack/evidence-sdk";

vi.mock("@tracepack/storage", () => ({ saveProjectAndFiles: vi.fn().mockResolvedValue(undefined) }));

// Only needed for the mixed-attachment-type test below, which needs a real "pdf" mime
// attachment alongside an image one -- same mocking approach and reasoning as
// packages/evidence-interchange/tests/pdf-pii-scan.test.ts: inspectPdf isn't meant to run
// standalone outside a browser tab, and this test is about category routing, not PDF text
// extraction.
vi.mock("@tracepack/document-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepack/document-engine")>();
  return { ...actual, inspectPdf: vi.fn().mockResolvedValue({ pageCount: 1, text: "", findings: [], textStatus: "no_text_layer" }) };
});

const { checkIncomingEvidence, guessExternalCategory, importExternalEvidence, isEvidenceMessage, READY_MESSAGE } = await import("./externalImport");

function categories(): EvidenceCategory[] {
  return [
    { id: "proof_of_purchase", name: "Proof of purchase", requirement: "required", description: "", acceptedTypes: ["pdf", "image", "webpage"] },
    { id: "correspondence", name: "Correspondence", requirement: "recommended", description: "", acceptedTypes: ["pdf", "image", "webpage"] },
    { id: "complaint_details", name: "Complaint details", requirement: "required", description: "", acceptedTypes: ["note"] },
  ];
}

function template(): TemplateSnapshot {
  return { id: "t", name: "Test template", version: "1", jurisdiction: "general", categories: categories(), exportSections: [] };
}

function project(): TracepackProject {
  return { id: "p1", schemaVersion: 1, title: "Test", organisation: "", summary: "", desiredResolution: "", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z", evidence: [], template: template() };
}

async function buildValidPayload(overrides: Record<string, unknown> = {}) {
  const draft = {
    schema_version: 1 as const,
    source: { producer_id: "com.example.giftshop", producer_name: "Example Gift Shop" },
    capture_timestamp: "2026-01-01T00:00:00Z",
    evidence_type: "product_return_dispute",
    attachments: [] as unknown[],
    observations: [{ id: "obs-1", kind: "note", label: "Order note", detail: "Item arrived damaged." }],
    integrity: { algorithm: "sha256" as const, canonicalization: "RFC8785" as const, payload_hash: "0".repeat(64) },
    ...overrides,
  };
  draft.integrity.payload_hash = await computePayloadHash(draft as never);
  return draft;
}

describe("isEvidenceMessage / checkIncomingEvidence", () => {
  it("rejects a message that isn't the expected shape at all", () => {
    expect(isEvidenceMessage(null)).toBe(false);
    expect(isEvidenceMessage({ foo: "bar" })).toBe(false);
    expect(isEvidenceMessage({ source: "someone-else", type: "evidence", payload: {} })).toBe(false);
  });

  it("rejects a message that has the right envelope but an invalid payload", async () => {
    const result = checkIncomingEvidence({ source: "tracepack-producer", type: "evidence", payload: { not: "valid" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it("accepts a structurally valid payload", async () => {
    const payload = await buildValidPayload();
    const result = checkIncomingEvidence({ source: "tracepack-producer", type: "evidence", payload });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.source.producer_name).toBe("Example Gift Shop");
  });

  it("exposes a stable READY_MESSAGE shape for the sender to recognise", () => {
    expect(READY_MESSAGE).toEqual({ source: "tracepack", type: "ready" });
  });
});

describe("guessExternalCategory", () => {
  it("guesses a category from evidence_type/source_url keywords, same as a captured webpage would", async () => {
    // With a real attachment (not the zero-attachment/synthesized-note case), the guess only
    // needs to land on a category that accepts that attachment's type -- image here.
    const payload = await buildValidPayload({
      evidence_type: "order_receipt", source_url: "https://giftshop.example/orders/123",
      attachments: [{ id: "att-1", filename: "receipt.png", mime_type: "image/png", size: 4, content_hash: "a".repeat(64), encoding: "base64", data: "AAAA" }],
    });
    const category = guessExternalCategory(payload as never, categories());
    expect(category?.id).toBe("proof_of_purchase");
  });

  it("never returns nothing when at least one category accepts notes, even with zero keyword matches", async () => {
    const payload = await buildValidPayload({ evidence_type: "unrelated_thing", source_url: undefined });
    const category = guessExternalCategory(payload as never, categories());
    expect(category).toBeDefined();
  });
});

describe("importExternalEvidence", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("imports a valid payload into the guessed category and reports how much evidence landed", async () => {
    const payload = await buildValidPayload();
    const result = await importExternalEvidence(project(), payload as never);
    expect(result.evidenceCount).toBe(1);
    expect(result.project.evidence).toHaveLength(1);
    expect(result.project.evidence[0]?.categoryId).toBe("complaint_details");
  });

  it("propagates a hash-mismatch failure instead of silently dropping it", async () => {
    const payload = await buildValidPayload();
    payload.integrity.payload_hash = "f".repeat(64); // now wrong, doesn't match the actual content
    await expect(importExternalEvidence(project(), payload as never)).rejects.toThrow(/integrity hash/i);
  });

  it("carries a real attachment through with its own fingerprint verified", async () => {
    const bytes = new TextEncoder().encode("hello evidence");
    const contentHash = await sha256Hex(bytes);
    const data = btoa(String.fromCharCode(...bytes));
    const payload = await buildValidPayload({
      attachments: [{ id: "att-1", filename: "receipt.png", mime_type: "image/png", size: bytes.length, content_hash: contentHash, encoding: "base64", data }],
    });
    const result = await importExternalEvidence(project(), payload as never);
    expect(result.project.evidence[0]?.categoryId).toBe("proof_of_purchase");
    expect(result.project.evidence[0]?.originalFileName).toBe("receipt.png");
  });

  it("routes a PDF and an image attachment in the same payload to their own separate categories, not one shared guess", async () => {
    // Regression: this used to guess a single category from the FIRST attachment only, then
    // file every attachment under it -- so a payload mixing types under a template with
    // type-specific categories misfiled whichever attachment wasn't first.
    const typedTemplate: TemplateSnapshot = {
      id: "typed", name: "Typed", version: "1", jurisdiction: "general", exportSections: [],
      categories: [
        { id: "documents", name: "Documents", requirement: "recommended", description: "", acceptedTypes: ["pdf"] },
        { id: "photos", name: "Photos", requirement: "recommended", description: "", acceptedTypes: ["image"] },
      ],
    };
    const typedProject: TracepackProject = { ...project(), template: typedTemplate };

    const pdfBytes = new TextEncoder().encode("pdf bytes");
    const imageBytes = new TextEncoder().encode("image bytes");
    const payload = await buildValidPayload({
      attachments: [
        { id: "att-pdf", filename: "doc.pdf", mime_type: "application/pdf", size: pdfBytes.length, content_hash: await sha256Hex(pdfBytes), encoding: "base64", data: btoa(String.fromCharCode(...pdfBytes)) },
        { id: "att-img", filename: "photo.png", mime_type: "image/png", size: imageBytes.length, content_hash: await sha256Hex(imageBytes), encoding: "base64", data: btoa(String.fromCharCode(...imageBytes)) },
      ],
    });

    const result = await importExternalEvidence(typedProject, payload as never);
    const pdfItem = result.project.evidence.find((item) => item.sourceType === "pdf");
    const imageItem = result.project.evidence.find((item) => item.sourceType === "image");
    expect(pdfItem?.categoryId).toBe("documents");
    expect(imageItem?.categoryId).toBe("photos");
  });

  it("rejects a PDF-only payload rather than misfiling it into an image-only category, when the template has no category for PDFs at all", async () => {
    // Regression (found on review of the fix above): guessCategory's own fallback used to
    // ignore the requested type entirely once its normal lookups came up empty, defaulting to
    // ANY category that accepted "image" -- so a template with only an image category, no
    // PDF category at all, still returned that image category for a PDF attachment. That
    // silently passed resolveCategoryId's "a category id was returned" check even though the
    // category never actually accepts PDFs, defeating the whole point of rejecting outright
    // rather than misfiling. Fixed in captures.ts's guessCategory; this proves the fix from
    // the actual importExternalEvidence caller, not just the helper in isolation.
    const imageOnlyTemplate: TemplateSnapshot = {
      id: "image-only", name: "Image only", version: "1", jurisdiction: "general", exportSections: [],
      categories: [{ id: "photos", name: "Photos", requirement: "recommended", description: "", acceptedTypes: ["image"] }],
    };
    const imageOnlyProject: TracepackProject = { ...project(), template: imageOnlyTemplate };

    const pdfBytes = new TextEncoder().encode("pdf bytes");
    const payload = await buildValidPayload({
      attachments: [{ id: "att-pdf", filename: "doc.pdf", mime_type: "application/pdf", size: pdfBytes.length, content_hash: await sha256Hex(pdfBytes), encoding: "base64", data: btoa(String.fromCharCode(...pdfBytes)) }],
    });

    // guessExternalCategory's own overall guess (used for the early "nothing fits at all"
    // check) is fixed by the same change, so this is caught there with a friendly message
    // before resolveCategoryId's later, more specific rejection is ever reached.
    await expect(importExternalEvidence(imageOnlyProject, payload as never)).rejects.toThrow(/no category.*accepts this kind of evidence/i);
  });
});
