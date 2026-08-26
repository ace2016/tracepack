import type {
  AttestationRequirementV1,
  MultiPartyAttestationPolicyV1,
} from "@tracepack/attestation";

import type {
  TracepackPackSnapshotV1,
} from "./types.js";

import {
  packSnapshotToAttestationSubject,
  type PackEvidenceFiles,
} from "./subject.js";

export async function createPackAttestationPolicy(
  snapshot: TracepackPackSnapshotV1,
  files: PackEvidenceFiles,
  requirements: AttestationRequirementV1[],
): Promise<MultiPartyAttestationPolicyV1> {
  return {
    policy_version:
      "tracepack-attestation-policy/v1",
    subject:
      await packSnapshotToAttestationSubject(
        snapshot,
        files,
      ),
    requirements,
  };
}
