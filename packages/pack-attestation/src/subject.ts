import {
  canonicalizeJson,
  sha256Hex,
  type AttestationSubjectV1,
} from "@tracepack/attestation";

import type {
  TracepackPackSnapshotV1,
} from "./types.js";

export async function computePackSnapshotDigest(
  snapshot: TracepackPackSnapshotV1,
): Promise<string> {
  return sha256Hex(
    canonicalizeJson(snapshot),
  );
}

export async function packSnapshotToAttestationSubject(
  snapshot: TracepackPackSnapshotV1,
): Promise<AttestationSubjectV1> {
  return {
    kind: "tracepack-pack",
    digest: {
      algorithm: "sha256",
      value:
        await computePackSnapshotDigest(
          snapshot,
        ),
    },
    pack_version:
      snapshot.pack_version,
  };
}
