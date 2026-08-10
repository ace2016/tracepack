import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateSnapshot, TracepackProject } from "@tracepack/evidence-core";
import type { TracepackEvidencePayloadV1 } from "@tracepack/evidence-sdk";

vi.mock("@tracepack/storage", () => ({ saveEvidenceFile: vi.fn().mockResolvedValue(undefined) }));

const { guessCategory, guessTemplate, explainTemplateMatch, jobFromExternalPayload, seedFromExternalPayload, importPendingCaptures } = await import("./captures");

function externalPayload(overrides: Partial<{ evidence_type: string; source_url: string; observations: Array<{ label: string; detail: string }>; subject: string; producer_name: string; attachments: TracepackEvidencePayloadV1["attachments"] }> = {}): TracepackEvidencePayloadV1 {
  return {
    schema_version: 1,
    source: { producer_id: "com.example.producer", producer_name: overrides.producer_name ?? "Example Producer" },
    capture_timestamp: "2026-08-09T00:00:00Z",
    source_url: overrides.source_url,
    evidence_type: overrides.evidence_type ?? "support_conversation",
    attachments: overrides.attachments ?? [],
    observations: (overrides.observations ?? []).map((entry, i) => ({ id: `obs-${i}`, kind: "note", label: entry.label, detail: entry.detail })),
    metadata: overrides.subject ? { subject: overrides.subject } : undefined,
    integrity: { algorithm: "sha256", canonicalization: "RFC8785", payload_hash: "0".repeat(64) },
  };
}

function baseProject(): TracepackProject {
  return {
    id: "p1", schemaVersion: 1, title: "Test project", organisation: "", summary: "", desiredResolution: "",
    createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z", evidence: [],
    template: {
      id: "t", name: "Test template", version: "1", jurisdiction: "UK",
      categories: [{ id: "webcat", name: "Web", requirement: "optional", description: "", acceptedTypes: ["webpage"] }],
      exportSections: [],
    },
  };
}

function stubChromeStorage(initialJobs: unknown[]) {
  const stored: Record<string, unknown> = { tracepackCaptureJobs: initialJobs };
  const set = vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); });
  const get = vi.fn(async (key: string) => ({ [key]: stored[key] }));
  vi.stubGlobal("chrome", { storage: { local: { get, set } } });
  return { stored, set };
}

describe("importPendingCaptures", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it("clears a completed capture's screenshot data from extension storage instead of retaining it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["x"], { type: "image/png" })) }));
    const job = { id: "job1", url: "https://example.com", title: "Example", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const };
    const { stored, set } = stubChromeStorage([job]);

    const result = await importPendingCaptures(baseProject());

    expect(result.evidence).toHaveLength(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(stored.tracepackCaptureJobs).toEqual([]);
  });

  it("keeps a failed capture (and its data) so it can be retried", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const job = { id: "job2", url: "https://example.com", title: "Example", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const };
    const { stored } = stubChromeStorage([job]);

    const result = await importPendingCaptures(baseProject());

    expect(result.evidence).toHaveLength(0);
    const remaining = stored.tracepackCaptureJobs as Array<{ status: string; screenshotDataUrl?: string }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.status).toBe("failed");
    expect(remaining[0]?.screenshotDataUrl).toBeDefined();
  });

  it("files a capture by what the page actually was, not just the first webpage category", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["x"], { type: "image/png" })) }));
    const project: TracepackProject = {
      ...baseProject(),
      template: {
        id: "t", name: "Test template", version: "1", jurisdiction: "UK",
        categories: [
          { id: "proof_of_purchase", name: "Proof of purchase", requirement: "required", description: "", acceptedTypes: ["webpage"] },
          { id: "terms_and_policy", name: "Terms and policy", requirement: "recommended", description: "", acceptedTypes: ["webpage"] },
        ],
        exportSections: [],
      },
    };
    const job = { id: "job3", url: "https://kitchenexample.com/help/returns-and-refunds", title: "Returns and refunds policy", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const };
    stubChromeStorage([job]);

    const result = await importPendingCaptures(project);

    expect(result.evidence[0]?.categoryId).toBe("terms_and_policy");
  });

  it("with onlyJobId set, imports only that one capture and leaves other pending captures untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["x"], { type: "image/png" })) }));
    const wantedJob = { id: "wanted", url: "https://example.com/a", title: "A", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const };
    const unrelatedJob = { id: "unrelated", url: "https://example.com/b", title: "B", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const };
    const { stored } = stubChromeStorage([wantedJob, unrelatedJob]);

    const result = await importPendingCaptures(baseProject(), "wanted");

    // The popup's post-capture pack picker passes onlyJobId so that choosing a pack for the
    // capture just shown never silently sweeps in some other, unrelated pending capture into
    // the same pack -- this is the regression that scoping guards against.
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.id).toBe("wanted");
    const remaining = stored.tracepackCaptureJobs as Array<{ id: string; status: string }>;
    expect(remaining.find((entry) => entry.id === "unrelated")?.status).toBe("pending");
  });

  it("with no onlyJobId, imports every pending capture as before (unscoped default)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["x"], { type: "image/png" })) }));
    const jobA = { id: "a", url: "https://example.com/a", title: "A", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const };
    const jobB = { id: "b", url: "https://example.com/b", title: "B", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const };
    stubChromeStorage([jobA, jobB]);

    const result = await importPendingCaptures(baseProject());

    expect(result.evidence).toHaveLength(2);
  });

  it("notes a full-page capture distinctly from a viewport capture, including when it was truncated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["x"], { type: "image/png" })) }));
    const viewportJob = { id: "job4", url: "https://example.com", title: "Example", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const };
    const fullPageJob = { id: "job5", url: "https://example.com/long", title: "Example long page", capturedAt: "2024-01-01T00:00:00.000Z", screenshotDataUrl: "data:image/png;base64,AA==", status: "pending" as const, mode: "full-page" as const, truncated: true };
    stubChromeStorage([viewportJob, fullPageJob]);

    const result = await importPendingCaptures(baseProject());

    const viewportItem = result.evidence.find((item) => item.id === "job4");
    const fullPageItem = result.evidence.find((item) => item.id === "job5");
    expect(viewportItem?.notes).toBe("Visible-page screenshot captured by the Tracepack extension.");
    expect(fullPageItem?.notes).toContain("Full-page screenshot");
    expect(fullPageItem?.notes).toContain("very long");
  });
});

describe("guessCategory", () => {
  // Regression: the final fallback used to be `?? categories.find((entry) =>
  // entry.acceptedTypes.includes("image"))` -- a hardcoded last resort that ignored the
  // acceptedType actually requested. A caller asking for "pdf" (or "note") with no matching
  // category, but SOME image-accepting category present, used to get that image category back
  // anyway -- wrong for a PDF, and silently indistinguishable from a real match to any caller
  // that only checks "did this return a category id at all".
  it("returns undefined, not an unrelated image category, when nothing accepts the requested type", () => {
    const categories = [{ id: "photos", name: "Photos", requirement: "optional" as const, description: "", acceptedTypes: ["image"] }];
    expect(guessCategory({ title: "A document", url: "https://example.com/doc" }, categories, "pdf")).toBeUndefined();
    expect(guessCategory({ title: "A note", url: "" }, categories, "note")).toBeUndefined();
  });

  it("still falls back to a category that genuinely accepts the requested type, with no keyword match", () => {
    const categories = [
      { id: "photos", name: "Photos", requirement: "optional" as const, description: "", acceptedTypes: ["image"] },
      { id: "documents", name: "Documents", requirement: "optional" as const, description: "", acceptedTypes: ["pdf"] },
    ];
    const match = guessCategory({ title: "Untitled", url: "https://example.com/x" }, categories, "pdf");
    expect(match?.id).toBe("documents");
  });

  // Regression: categoryHints is keyed to Consumer Complaint's own category ids
  // ("correspondence"), so it silently fails on any template using a different id for the same
  // concept, e.g. Provenance Trace's "communications". A support-shaped payload used to fall
  // through to the first category that merely accepts a note, "service_and_maintenance", which
  // is wrong regardless of template. Role resolution fixes this for any template, not just the
  // one case that happened to surface it.
  it("routes correspondence-ish text to whichever category declares role: correspondence, on any template", () => {
    const categories = [
      { id: "service_and_maintenance", name: "Service and maintenance records", requirement: "recommended" as const, description: "", acceptedTypes: ["pdf", "image", "note"] },
      { id: "communications", name: "Communications", requirement: "optional" as const, description: "", acceptedTypes: ["pdf", "image", "webpage", "note"], role: "correspondence" },
    ];
    const match = guessCategory({ title: "support_conversation", url: "" }, categories, "note");
    expect(match?.id).toBe("communications");
  });

  it("falls back to the id-specific hint table when no category on this template has a role tag", () => {
    const categories = [
      { id: "correspondence", name: "Seller correspondence", requirement: "recommended" as const, description: "", acceptedTypes: ["pdf", "image", "webpage", "note"] },
      { id: "supporting_evidence", name: "Supporting evidence", requirement: "optional" as const, description: "", acceptedTypes: ["pdf", "image", "webpage", "note"] },
    ];
    const match = guessCategory({ title: "support_conversation", url: "" }, categories, "note");
    expect(match?.id).toBe("correspondence");
  });
});

describe("guessTemplate", () => {
  function template(id: string): TemplateSnapshot {
    return { id, name: id, version: "1", jurisdiction: "general", categories: [], exportSections: [] };
  }
  const available = [template("consumer-complaint"), template("provenance-trace"), template("general")];

  it("recommends Provenance Trace for a captured auction/classic-vehicle listing", () => {
    const match = guessTemplate({ title: "1967 Ford Mustang, classic restoration, matching numbers", url: "https://classiccarauctions.example/lot/42" }, available);
    expect(match?.id).toBe("provenance-trace");
  });

  it("recommends consumer-complaint for a captured order/refund page", () => {
    const match = guessTemplate({ title: "Your order confirmation", url: "https://shop.example/checkout/receipt" }, available);
    expect(match?.id).toBe("consumer-complaint");
  });

  it("returns undefined rather than guessing when nothing matches", () => {
    const match = guessTemplate({ title: "Weather forecast for Tuesday", url: "https://weather.example/tuesday" }, available);
    expect(match).toBeUndefined();
  });

  it("does not recommend a template that isn't actually available", () => {
    const match = guessTemplate({ title: "Classic car auction", url: "https://example.com/auction" }, [template("consumer-complaint")]);
    expect(match).toBeUndefined();
  });
});

describe("explainTemplateMatch", () => {
  it("names the signals that actually matched, not just that something matched", () => {
    const job = { title: "1967 Ford Mustang, restoration and matching numbers, VIN verified", url: "" };
    const reason = explainTemplateMatch(job, "provenance-trace");
    expect(reason).toContain("origin or history");
  });

  it("joins two matched signals into a natural phrase", () => {
    const job = { title: "Seller correspondence regarding a refund dispute", url: "" };
    const reason = explainTemplateMatch(job, "consumer-complaint");
    expect(reason).toMatch(/ and /);
  });

  it("is undefined for a template with no signal table (General)", () => {
    const reason = explainTemplateMatch({ title: "Anything at all", url: "" }, "general");
    expect(reason).toBeUndefined();
  });

  it("is undefined when nothing actually matched", () => {
    const reason = explainTemplateMatch({ title: "Weather forecast", url: "" }, "consumer-complaint");
    expect(reason).toBeUndefined();
  });
});

describe("jobFromExternalPayload", () => {
  it("builds a job from the evidence_type and every observation's label and detail text", () => {
    const payload = externalPayload({
      evidence_type: "support_conversation",
      observations: [{ label: "Support conversation summary", detail: "Dispute over a vintage motorcycle's restoration history." }],
    });
    const job = jobFromExternalPayload(payload);
    expect(job.title).toContain("support conversation");
    expect(job.title).toContain("restoration");
  });

  it("returns undefined from guessTemplate when nothing in the conversation matches any template", () => {
    const payload = externalPayload({ observations: [{ label: "Support conversation summary", detail: "General enquiry, nothing template-specific here." }] });
    const job = jobFromExternalPayload(payload);
    const templates: TemplateSnapshot[] = [
      { id: "consumer-complaint", name: "Consumer complaint", version: "1", jurisdiction: "general", categories: [], exportSections: [] },
      { id: "provenance-trace", name: "Provenance Trace", version: "1", jurisdiction: "general", categories: [], exportSections: [] },
    ];
    expect(guessTemplate(job, templates)).toBeUndefined();
  });
});

describe("seedFromExternalPayload", () => {
  it("takes the title from metadata.subject", () => {
    const payload = externalPayload({ subject: "Vintage motorcycle restoration dispute" });
    expect(seedFromExternalPayload(payload).title).toBe("Vintage motorcycle restoration dispute");
  });

  it("builds the summary from structural counts only, never from observation prose", () => {
    const payload = externalPayload({
      producer_name: "Example Producer",
      observations: [{ label: "Support conversation summary", detail: "Contact the customer at buyer@example.com about the refund." }],
    });
    const seed = seedFromExternalPayload(payload);
    expect(seed.summary).toContain("Example Producer");
    expect(seed.summary).toContain("1 observation");
    // The whole point of this test: project.summary is never privacy-scanned anywhere in the
    // app (see export-engine, which renders it straight to the PDF cover), so the raw
    // observation detail, which can contain real PII a producer never redacted, must never end
    // up in it, only a structural count of what was imported.
    expect(seed.summary).not.toContain("buyer@example.com");
    expect(seed.summary).not.toContain("Contact the customer");
  });

  it("omits the summary entirely when there is nothing to count", () => {
    const payload = externalPayload({ observations: [], attachments: [] });
    expect(seedFromExternalPayload(payload).summary).toBeUndefined();
  });
});
