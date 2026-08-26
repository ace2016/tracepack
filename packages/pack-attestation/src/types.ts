export interface TracepackPackSnapshotCategoryV1 {
  id: string;
  name: string;
}

export interface TracepackPackSnapshotEvidenceV1 {
  id: string;
  title: string;
  category_id: string;
  source_type: string;
  original_file_name: string | null;
  source_url: string | null;
  imported_at: string;
  event_date: string | null;
  content_hash: string;
  review_status: string;
  privacy_findings: unknown[];
  manual_redactions: unknown[];
  provenance: unknown | null;
  observations: unknown[];
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
    categories: TracepackPackSnapshotCategoryV1[];
  };

  evidence: TracepackPackSnapshotEvidenceV1[];

  pack_version: number;
}
