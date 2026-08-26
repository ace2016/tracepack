import type {
  TracepackProject,
} from "@tracepack/evidence-core";

import type {
  TracepackPackSnapshotCategoryV1,
  TracepackPackSnapshotEvidenceV1,
  TracepackPackSnapshotV1,
} from "./types.js";

function compareStrings(
  left: string,
  right: string,
): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function compareEvidence(
  left: TracepackPackSnapshotEvidenceV1,
  right: TracepackPackSnapshotEvidenceV1,
): number {
  return compareStrings(
    left.id,
    right.id,
  );
}

function compareCategories(
  left: TracepackPackSnapshotCategoryV1,
  right: TracepackPackSnapshotCategoryV1,
): number {
  return compareStrings(
    left.id,
    right.id,
  );
}

function assertUniqueEvidenceIds(
  project: TracepackProject,
): void {
  const seen =
    new Set<string>();

  for (const item of project.evidence) {
    if (seen.has(item.id)) {
      throw new TypeError(
        `Duplicate evidence id: ${item.id}`,
      );
    }

    seen.add(item.id);
  }
}

export function createPackSnapshot(
  project: TracepackProject,
  packVersion: number,
): TracepackPackSnapshotV1 {
  if (
    !Number.isSafeInteger(packVersion) ||
    packVersion < 1
  ) {
    throw new TypeError(
      "packVersion must be a positive safe integer.",
    );
  }

  assertUniqueEvidenceIds(project);

  return {
    format: "tracepack-pack-snapshot",
    version: 1,

    project: {
      id: project.id,
      title: project.title,
      organisation:
        project.organisation,
      summary:
        project.summary,
    },

    template: {
      id: project.template.id,
      version:
        project.template.version,
      categories:
        project.template.categories
          .map((category) => ({
            id: category.id,
            name: category.name,
          }))
          .sort(compareCategories),
    },

    evidence:
      project.evidence
        .filter(
          (item) =>
            item.reviewStatus !==
            "excluded",
        )
        .map((item) => ({
          id: item.id,
          title: item.title,
          category_id:
            item.categoryId,
          source_type:
            item.sourceType,
          original_file_name:
            item.originalFileName ??
            null,
          source_url:
            item.sourceUrl ??
            null,
          imported_at:
            item.importedAt,
          event_date:
            item.eventDate ??
            null,
          content_hash:
            item.contentHash,
          review_status:
            item.reviewStatus,
          privacy_findings:
            item.privacyFindings ?? [],
          manual_redactions:
            item.manualRedactions ?? [],
          provenance:
            item.provenance ?? null,
          observations:
            item.observations ?? [],
        }))
        .sort(compareEvidence),

    pack_version: packVersion,
  };
}
