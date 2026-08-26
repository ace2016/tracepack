import type {
  TracepackProject,
} from "@tracepack/evidence-core";

import type {
  TracepackPackSnapshotV1,
} from "./types.js";

function compareEvidence(
  left: TracepackPackSnapshotV1["evidence"][number],
  right: TracepackPackSnapshotV1["evidence"][number],
): number {
  return left.id.localeCompare(right.id);
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

  return {
    format: "tracepack-pack-snapshot",
    version: 1,

    project: {
      id: project.id,
      title: project.title,
    },

    template: {
      id: project.template.id,
      version: project.template.version,
    },

    evidence: project.evidence
      .map((item) => ({
        id: item.id,
        category_id: item.categoryId,
        content_hash: item.contentHash,
        review_status: item.reviewStatus,
      }))
      .sort(compareEvidence),

    pack_version: packVersion,
  };
}
