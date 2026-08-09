# @tracepack/evidence-core

Tracepack's core domain model, with zero framework or runtime dependency: `TracepackProject`,
`EvidenceItem`, `TemplateSnapshot`, `PrivacyFinding`, and the pure functions that operate on
them. This is the type/logic layer `@tracepack/template-engine`, `@tracepack/evidence-sdk`, and
Tracepack's own apps all build on -- not a UI, not storage, not PDF handling.

## Install

```
npm install @tracepack/evidence-core
```

## What's in here

- **Types**: `TracepackProject`, `EvidenceItem`, `EvidenceCategory`, `TemplateSnapshot`,
  `PrivacyFinding`, `ChronologyGap`, and the supporting field types (`Requirement`,
  `ReviewStatus`, `SourceType`, `PrivacyFindingKind` -- all open (`string`), not closed unions;
  a template or producer can declare kinds this package has never heard of).
- **Pure functions**:
  - `createProject(...)` -- builds a new `TracepackProject` from a template snapshot.
  - `addEvidence(project, item)` -- returns a new project with one more evidence item (never
    mutates the input).
  - `getCategoryProgress(project)` -- per-category completion state against the template's
    `requirement`/`minItems`.
  - `getRequiredSummary(project)` -- a project-level "N of M required categories complete" roll-up.
  - `getChronologyGaps(project)` -- flags a gap between two pieces of dated evidence wider than
    the template's `chronologyRules.maxGapDays`, when the template declares one.
  - `diffManifests(before, after)` -- compares two exported `manifest.json` files (the
    `tracepack-source-manifest` shape `@tracepack/export-engine`'s `buildManifest` produces) by
    evidence item id and `contentHash`. Returns what was added, removed, had its content hash
    change (an anomaly -- Tracepack's own export guarantee is that an item's original bytes are
    never mutated), or had an ordinary metadata field (title, category, review status) change.
    Exposed as `tracepack diff-manifest <before.json> <after.json>` in `@tracepack/cli`.
  - `looksLikeTracepackManifest(value)` -- a lightweight structural check, so a caller gets a
    clear rejection reason before `diffManifests` would otherwise fail confusingly on
    `.evidence` of an unrelated JSON file.

Every function here is pure -- given the same input, always the same output, no I/O, no mutation
of its arguments. That's deliberate: this package has no opinion about where a `TracepackProject`
is stored or rendered.

## Usage

```ts
import { createProject, addEvidence, getCategoryProgress, type TemplateSnapshot } from "@tracepack/evidence-core";

const template: TemplateSnapshot = {
  id: "example", name: "Example", version: "1.0.0", jurisdiction: "general",
  categories: [{ id: "docs", name: "Documents", requirement: "required", description: "", acceptedTypes: ["pdf"] }],
  exportSections: [],
};

let project = createProject({ title: "My pack", organisation: "", summary: "", desiredResolution: "", template });
project = addEvidence(project, {
  id: "item-1", projectId: project.id, title: "Receipt", categoryId: "docs",
  sourceType: "pdf", originalFileName: "receipt.pdf", importedAt: new Date().toISOString(),
  contentHash: "…", reviewStatus: "needs_review", notes: "", size: 1024, mimeType: "application/pdf",
});

console.log(getCategoryProgress(project));
```

## License

MIT
