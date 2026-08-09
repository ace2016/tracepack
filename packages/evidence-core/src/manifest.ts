// The exported JSON manifest's wire shape -- the same "tracepack-source-manifest" format
// export-engine's buildManifest() produces (see packages/export-engine/src/index.ts). Kept
// here, in the zero-dependency domain package, rather than in export-engine itself, so a pure
// diff function can be used from @tracepack/cli (and any other Node tooling) without pulling
// in export-engine's PDF/zip dependencies (pdf-lib, fflate, document-engine) just to compare
// two JSON files nobody needs a browser to read.
export interface ManifestEvidenceEntry {
  id: string;
  title: string;
  categoryId: string;
  sourceType: string;
  originalFileName: string | null;
  sourceUrl: string | null;
  importedAt: string;
  eventDate: string | null;
  contentHash: string;
  reviewStatus: string;
  provenance?: unknown;
  observations?: unknown;
}

export interface TracepackManifest {
  format: string;
  version: number;
  exportedAt: string;
  project: { id: string; title: string; templateId: string; templateVersion: string };
  evidence: ManifestEvidenceEntry[];
}

/** Fields compared for a "metadata changed" diff entry -- deliberately not every field:
 *  importedAt is set once at import and never meaningfully re-compared, and
 *  provenance/observations are producer-supplied claims (see SPEC.md sections 4-5), not
 *  Tracepack-owned state a diff between two of *our own* exports should be judging. */
const COMPARED_METADATA_FIELDS = [
  "title",
  "categoryId",
  "sourceType",
  "originalFileName",
  "sourceUrl",
  "eventDate",
  "reviewStatus",
] as const satisfies readonly (keyof ManifestEvidenceEntry)[];

export interface ManifestContentChange {
  id: string;
  before: ManifestEvidenceEntry;
  after: ManifestEvidenceEntry;
}

export interface ManifestMetadataChange {
  id: string;
  before: ManifestEvidenceEntry;
  after: ManifestEvidenceEntry;
  changedFields: (typeof COMPARED_METADATA_FIELDS)[number][];
}

export interface ManifestDiff {
  beforeProjectId: string;
  afterProjectId: string;
  added: ManifestEvidenceEntry[];
  removed: ManifestEvidenceEntry[];
  /** Same evidence id, different contentHash. Tracepack's own export guarantee is that an
   *  evidence item's original bytes are never mutated (see ARCHITECTURE.md's "Never silently
   *  mutate the original"), so this is an anomaly worth surfacing loudly -- a different item
   *  was substituted under the same id, or something upstream is not honouring that guarantee
   *  -- not an ordinary edit. Kept structurally separate from metadataChanged for exactly that
   *  reason: a caller should be able to treat this list as a hard failure without also failing
   *  on routine title/category edits. */
  contentChanged: ManifestContentChange[];
  metadataChanged: ManifestMetadataChange[];
  unchangedCount: number;
}

/**
 * Compares two exported manifests by evidence item id + contentHash. Pure and synchronous --
 * no file I/O, no network -- so it runs identically in the browser, Node, or @tracepack/cli.
 */
export function diffManifests(before: TracepackManifest, after: TracepackManifest): ManifestDiff {
  const beforeById = new Map(before.evidence.map((item) => [item.id, item]));
  const afterById = new Map(after.evidence.map((item) => [item.id, item]));

  const added: ManifestEvidenceEntry[] = [];
  const removed: ManifestEvidenceEntry[] = [];
  const contentChanged: ManifestContentChange[] = [];
  const metadataChanged: ManifestMetadataChange[] = [];
  let unchangedCount = 0;

  for (const [id, beforeItem] of beforeById) {
    const afterItem = afterById.get(id);
    if (!afterItem) {
      removed.push(beforeItem);
      continue;
    }
    if (afterItem.contentHash !== beforeItem.contentHash) {
      contentChanged.push({ id, before: beforeItem, after: afterItem });
      continue;
    }
    const changedFields = COMPARED_METADATA_FIELDS.filter((field) => beforeItem[field] !== afterItem[field]);
    if (changedFields.length > 0) {
      metadataChanged.push({ id, before: beforeItem, after: afterItem, changedFields });
    } else {
      unchangedCount += 1;
    }
  }

  for (const [id, afterItem] of afterById) {
    if (!beforeById.has(id)) added.push(afterItem);
  }

  return {
    beforeProjectId: before.project.id,
    afterProjectId: after.project.id,
    added,
    removed,
    contentChanged,
    metadataChanged,
    unchangedCount,
  };
}

/** True only for something structurally shaped like a manifest -- enough to give a caller a
 *  clear rejection reason before diffManifests would otherwise fail confusingly on `.evidence`
 *  of an unrelated JSON file. Does not validate every field; diffManifests itself is tolerant
 *  of extra/missing optional fields the same way the rest of this format is. */
export function looksLikeTracepackManifest(value: unknown): value is TracepackManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.format === "tracepack-source-manifest" &&
    typeof candidate.version === "number" &&
    typeof candidate.project === "object" &&
    candidate.project !== null &&
    Array.isArray(candidate.evidence)
  );
}
