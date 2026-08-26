import type {
  JsonObject,
} from "@tracepack/attestation";

export interface TracepackPackSnapshotCategoryV1 {
  id: string;
  name: string;
}

export interface TracepackPackSnapshotPrivacyLocationV1 {
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TracepackPackSnapshotPrivacyFindingV1 {
  value: string;
  decision: string;
  field: string | null;
  location:
    | TracepackPackSnapshotPrivacyLocationV1
    | null;
}

export interface TracepackPackSnapshotManualRedactionV1 {
  kind: string;
  page_number: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  decision: string;
}

export interface TracepackPackSnapshotProvenanceV1 {
  producer_id: string;
  producer_name: string;
  producer_version: string | null;
  schema_version: 1;
  captured_at: string;
  source_url: string | null;
  external_reference: string | null;
  attachment_count: number | null;
}

export interface TracepackPackSnapshotObservationV1 {
  id: string;
  kind: string;
  label: string;
  detail: string;
  confidence: number | null;
  data: JsonObject | null;
}

export interface TracepackPackSnapshotEvidenceV1 {
  id: string;
  title: string;
  category_id: string;
  source_type: string;
  mime_type: string;
  original_file_name: string | null;
  source_url: string | null;
  imported_at: string;
  event_date: string | null;
  content_hash: string;
  review_status: string;
  privacy_findings:
    TracepackPackSnapshotPrivacyFindingV1[];
  manual_redactions:
    TracepackPackSnapshotManualRedactionV1[];
  provenance:
    | TracepackPackSnapshotProvenanceV1
    | null;
  observations:
    TracepackPackSnapshotObservationV1[];
}

export interface TracepackPackSnapshotV1 {
  format: "tracepack-pack-snapshot";
  version: 1;

  project: {
    id: string;
    title: string;
    organisation: string;
    summary: string;
  };

  template: {
    id: string;
    version: string;
    categories:
      TracepackPackSnapshotCategoryV1[];
  };

  evidence:
    TracepackPackSnapshotEvidenceV1[];

  pack_version: number;
}
