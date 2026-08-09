import { describe, expect, it } from "vitest";
import { addEvidence, createProject, getCategoryProgress, getChronologyGaps, getRequiredSummary, type EvidenceItem, type TemplateSnapshot } from "../src";

const template: TemplateSnapshot = {
  id: "test",
  name: "Test",
  version: "1.0.0",
  jurisdiction: "general",
  exportSections: [],
  categories: [
    { id: "details", name: "Details", description: "", requirement: "required", acceptedTypes: ["note"] },
  ],
};

function item(categoryId: string, id: string): EvidenceItem {
  return { id, projectId: "p", title: id, categoryId, sourceType: "note", importedAt: "2024-01-01T00:00:00.000Z", contentHash: id, reviewStatus: "needs_review", notes: "", size: 1, mimeType: "text/plain" };
}

describe("template progress", () => {
  it("reports missing required evidence without creating a mystery score", () => {
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template });
    expect(getRequiredSummary(project)).toEqual({ complete: 0, total: 1 });
  });

  it("a category with no minItems declared stays satisfied by exactly one item, same as before minItems existed", () => {
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template });
    const withOne = addEvidence(project, item("details", "e1"));
    expect(getCategoryProgress(withOne)[0]?.complete).toBe(true);
  });

  it("a category declaring minItems is not complete until that many items exist", () => {
    const withMin: TemplateSnapshot = { ...template, categories: [{ ...template.categories[0]!, minItems: 2 }] };
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template: withMin });
    const withOne = addEvidence(project, item("details", "e1"));
    expect(getCategoryProgress(withOne)[0]).toMatchObject({ itemCount: 1, complete: false });
    const withTwo = addEvidence(withOne, item("details", "e2"));
    expect(getCategoryProgress(withTwo)[0]).toMatchObject({ itemCount: 2, complete: true });
  });

  it("an excluded item never counts toward minItems, same as the existing >0 rule", () => {
    const withMin: TemplateSnapshot = { ...template, categories: [{ ...template.categories[0]!, minItems: 2 }] };
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template: withMin });
    const withTwo = addEvidence(addEvidence(project, item("details", "e1")), { ...item("details", "e2"), reviewStatus: "excluded" });
    expect(getCategoryProgress(withTwo)[0]).toMatchObject({ itemCount: 1, complete: false });
  });
});

describe("getChronologyGaps", () => {
  const withChronology: TemplateSnapshot = { ...template, chronologyRules: { maxGapDays: 30 } };

  it("returns nothing for a template with no chronologyRules declared", () => {
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template });
    const withDates = addEvidence(
      addEvidence(project, { ...item("details", "e1"), eventDate: "2024-01-01" }),
      { ...item("details", "e2"), eventDate: "2024-06-01" },
    );
    expect(getChronologyGaps(withDates)).toEqual([]);
  });

  it("flags a real gap wider than maxGapDays between two dated items", () => {
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template: withChronology });
    const withGap = addEvidence(
      addEvidence(project, { ...item("details", "e1"), eventDate: "2024-01-01" }),
      { ...item("details", "e2"), eventDate: "2024-06-01" },
    );
    const gaps = getChronologyGaps(withGap);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ fromItemId: "e1", toItemId: "e2", fromDate: "2024-01-01", toDate: "2024-06-01" });
    expect(gaps[0]?.days).toBeGreaterThan(30);
  });

  it("does not flag consecutive dated items within the allowed window", () => {
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template: withChronology });
    const withinWindow = addEvidence(
      addEvidence(project, { ...item("details", "e1"), eventDate: "2024-01-01" }),
      { ...item("details", "e2"), eventDate: "2024-01-15" },
    );
    expect(getChronologyGaps(withinWindow)).toEqual([]);
  });

  it("ignores undated items entirely -- they can't anchor either side of a gap", () => {
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template: withChronology });
    const mixed = addEvidence(
      addEvidence(addEvidence(project, { ...item("details", "e1"), eventDate: "2024-01-01" }), item("details", "undated")),
      { ...item("details", "e2"), eventDate: "2024-01-10" },
    );
    expect(getChronologyGaps(mixed)).toEqual([]);
  });

  it("excludes an excluded item from gap calculation, same as category progress does", () => {
    const project = createProject({ title: "Case", organisation: "", summary: "", desiredResolution: "", template: withChronology });
    const withExcluded = addEvidence(
      addEvidence(project, { ...item("details", "e1"), eventDate: "2024-01-01" }),
      { ...item("details", "e2"), eventDate: "2024-06-01", reviewStatus: "excluded" },
    );
    expect(getChronologyGaps(withExcluded)).toEqual([]);
  });
});
