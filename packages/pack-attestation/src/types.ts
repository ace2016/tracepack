export interface TracepackPackSnapshotEvidenceV1 {
  id: string;
  category_id: string;
  content_hash: string;
  review_status: string;
}

export interface TracepackPackSnapshotV1 {
  format: "tracepack-pack-snapshot";
  version: 1;

  project: {
    id: string;
    title: string;
  };

  template: {
    id: string;
    version: string;
  };

  evidence: TracepackPackSnapshotEvidenceV1[];

  pack_version: number;
}
