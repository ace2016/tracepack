import type {
  ExternalObservation,
  TracepackProject,
} from "@tracepack/evidence-core";

import type {
  JsonObject,
  JsonValue,
} from "@tracepack/attestation";

import type {
  TracepackPackSnapshotCategoryV1,
  TracepackPackSnapshotProvenanceV1,
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

function snapshotJsonValue(
  value: unknown,
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Observation data must contain only finite JSON numbers.",
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (entry) =>
        snapshotJsonValue(entry),
    );
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    const prototype =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new TypeError(
        "Observation data must contain only plain JSON objects.",
      );
    }

    const output: JsonObject = {};

    for (
      const [key, entry]
      of Object.entries(value)
    ) {
      output[key] =
        snapshotJsonValue(entry);
    }

    return output;
  }

  throw new TypeError(
    "Observation data must be JSON-compatible.",
  );
}

function snapshotObservationData(
  observation: ExternalObservation,
): JsonObject | null {
  if (observation.data === undefined) {
    return null;
  }

  return snapshotJsonValue(
    observation.data,
  ) as JsonObject;
}

function snapshotProvenance(
  projectItem:
    TracepackProject["evidence"][number],
): TracepackPackSnapshotProvenanceV1 | null {
  const provenance =
    projectItem.provenance;

  if (!provenance) {
    return null;
  }

  return {
    producer_id:
      provenance.producerId,
    producer_name:
      provenance.producerName,
    producer_version:
      provenance.producerVersion ??
      null,
    schema_version:
      provenance.schemaVersion,
    captured_at:
      provenance.capturedAt,
    source_url:
      provenance.sourceUrl ??
      null,
    external_reference:
      provenance.externalReference ??
      null,
    attachment_count:
      provenance.attachmentCount ??
      null,
  };
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
          mime_type:
            item.mimeType,
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
            (item.privacyFindings ?? [])
              .map((finding) => ({
                value:
                  finding.value,
                decision:
                  finding.decision,
                field:
                  finding.field ??
                  null,
                location:
                  finding.location
                    ? {
                        page_number:
                          finding.location
                            .pageNumber,
                        x:
                          finding.location.x,
                        y:
                          finding.location.y,
                        width:
                          finding.location.width,
                        height:
                          finding.location.height,
                      }
                    : null,
              })),

          manual_redactions:
            (item.manualRedactions ?? [])
              .map((region) => ({
                kind:
                  region.kind,
                page_number:
                  region.pageNumber ??
                  null,
                x: region.x,
                y: region.y,
                width:
                  region.width,
                height:
                  region.height,
                decision:
                  region.decision,
              })),

          provenance:
            snapshotProvenance(item),

          observations:
            (item.observations ?? [])
              .map((observation) => ({
                id:
                  observation.id,
                kind:
                  observation.kind,
                label:
                  observation.label,
                detail:
                  observation.detail,
                confidence:
                  observation.confidence ??
                  null,
                data:
                  snapshotObservationData(
                    observation,
                  ),
              })),
        })),

    pack_version: packVersion,
  };
}
