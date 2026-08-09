import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateSnapshot, TracepackProject } from "@tracepack/evidence-core";

vi.mock("@tracepack/storage", () => ({ saveEvidenceFile: vi.fn().mockResolvedValue(undefined) }));

const { guessCategory, guessTemplate, importPendingCaptures } = await import("./captures");

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
