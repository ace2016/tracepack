import {
  canonicalizeJson,
  sha256Hex,
  type AttestationSubjectV1,
} from "@tracepack/attestation";

import type {
  TracepackPackSnapshotV1,
} from "./types.js";

export type PackEvidenceFiles =
  ReadonlyMap<string, Blob>;

export async function computePackSnapshotDigest(
  snapshot: TracepackPackSnapshotV1,
): Promise<string> {
  return sha256Hex(
    canonicalizeJson(snapshot),
  );
}

export async function verifyPackEvidenceBytes(
  snapshot: TracepackPackSnapshotV1,
  files: PackEvidenceFiles,
): Promise<void> {
  for (const item of snapshot.evidence) {
    const blob =
      files.get(item.id);

    if (!blob) {
      throw new Error(
        `Missing evidence bytes for included item: ${item.id}`,
      );
    }

    const bytes =
      new Uint8Array(
        await blob.arrayBuffer(),
      );

    const actualHash =
      await sha256Hex(bytes);

    if (
      actualHash !==
      item.content_hash
    ) {
      throw new Error(
        `Evidence bytes do not match contentHash for included item: ${item.id}`,
      );
    }
  }
}

export async function packSnapshotToAttestationSubject(
  snapshot: TracepackPackSnapshotV1,
  files: PackEvidenceFiles,
): Promise<AttestationSubjectV1> {
  /*
   * Freeze the logical subject synchronously before
   * the first await. This prevents caller mutation
   * during blob hashing from changing the snapshot
   * after some evidence has already been verified.
   */
  const frozenSnapshot =
    JSON.parse(
      canonicalizeJson(snapshot),
    ) as TracepackPackSnapshotV1;

  await verifyPackEvidenceBytes(
    frozenSnapshot,
    files,
  );

  return {
    kind: "tracepack-pack",
    digest: {
      algorithm: "sha256",
      value:
        await computePackSnapshotDigest(
          frozenSnapshot,
        ),
    },
    pack_version:
      frozenSnapshot.pack_version,
  };
}
