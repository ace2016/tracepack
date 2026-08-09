import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { TracepackProject } from "@tracepack/evidence-core";

function project(id: string, evidenceIds: string[] = []): TracepackProject {
  return {
    id, schemaVersion: 1, title: "Test project", organisation: "", summary: "", desiredResolution: "",
    createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
    template: { id: "t", name: "Test", version: "1", jurisdiction: "UK", categories: [], exportSections: [] },
    evidence: evidenceIds.map((evidenceId) => ({
      id: evidenceId, projectId: id, title: "Item", categoryId: "c", sourceType: "note",
      importedAt: "2024-01-01T00:00:00.000Z", contentHash: "a".repeat(64), reviewStatus: "needs_review",
      notes: "", size: 3, mimeType: "text/plain",
    })),
  };
}

describe("saveProjectAndFiles", () => {
  // fake-indexeddb keeps its database in memory for the process lifetime, so each test
  // needs a fresh database name to avoid seeing another test's committed writes.
  let storage: typeof import("../src/index");
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- re-import isn't needed; vitest isolates modules per file
    storage = await import("../src/index");
  });

  it("persists the project and every blob together on success", async () => {
    const p = project("p1", ["e1", "e2"]);
    const files = new Map([
      ["e1", new Blob(["one"], { type: "text/plain" })],
      ["e2", new Blob(["two"], { type: "text/plain" })],
    ]);

    await storage.saveProjectAndFiles(p, files);

    expect(await storage.getProject("p1")).toEqual(p);
    expect((await storage.getEvidenceFile("e1"))?.blob).toBeInstanceOf(Blob);
    expect((await storage.getEvidenceFile("e2"))?.blob).toBeInstanceOf(Blob);
    await expect((await storage.getEvidenceFile("e1"))!.blob.text()).resolves.toBe("one");
  });

  it("rolls back the whole write — project included — when one blob write in the batch fails", async () => {
    const p = project("p2", ["e3", "e4"]);
    // A value the structured clone algorithm can't handle (a function) fails synchronously,
    // inside put() itself, before an IDBRequest is even queued. Per the IndexedDB spec, a
    // transaction only auto-aborts on a *failed request* — a synchronous throw with no
    // request behind it does NOT auto-abort, so anything already queued before this point
    // (the project write, or "e3" here) would otherwise commit on its own, silently breaking
    // atomicity. This is exactly the failure saveProjectAndFiles's explicit abort-on-error
    // exists to guard against; confirmed directly against fake-indexeddb before this test was
    // written, not assumed from reading the spec.
    const files = new Map([
      ["e3", new Blob(["three"], { type: "text/plain" })],
      ["e4", { fn: () => "not cloneable" } as unknown as Blob],
    ]);

    await expect(storage.saveProjectAndFiles(p, files)).rejects.toBeTruthy();

    expect(await storage.getProject("p2")).toBeUndefined();
    expect(await storage.getEvidenceFile("e3")).toBeUndefined();
    expect(await storage.getEvidenceFile("e4")).toBeUndefined();
  });

  it("does not disturb a previously-saved project when a later saveProjectAndFiles call fails", async () => {
    const original = project("p3", ["e5"]);
    await storage.saveProjectAndFiles(original, new Map([["e5", new Blob(["five"], { type: "text/plain" })]]));

    const updated = project("p3", ["e5", "e6"]);
    const badFiles = new Map([
      ["e6", { fn: () => "not cloneable" } as unknown as Blob],
    ]);
    await expect(storage.saveProjectAndFiles(updated, badFiles)).rejects.toBeTruthy();

    // The earlier, successfully-committed state must survive an unrelated later failure.
    expect(await storage.getProject("p3")).toEqual(original);
    expect(await storage.getEvidenceFile("e5")).toBeDefined();
    expect(await storage.getEvidenceFile("e6")).toBeUndefined();
  });
});
