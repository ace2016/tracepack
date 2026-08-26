import type {
  AttestationSignerV1,
  AttestationStatementV1,
  JsonObject,
} from "@tracepack/attestation";

import type {
  TracepackPackSnapshotV1,
} from "./types.js";

import {
  packSnapshotToAttestationSubject,
} from "./subject.js";

export interface CreatePackAttestationStatementOptions {
  attestationId: string;
  statementType: string;
  statementText: string;
  signer: AttestationSignerV1;
  issuedAt: string;
  metadata?: JsonObject;
}

export async function createPackAttestationStatement(
  snapshot: TracepackPackSnapshotV1,
  options: CreatePackAttestationStatementOptions,
): Promise<AttestationStatementV1> {
  const subject =
    await packSnapshotToAttestationSubject(
      snapshot,
    );

  return {
    schema_version:
      "tracepack-attestation/v1",
    attestation_id:
      options.attestationId,
    subject,
    statement: {
      type:
        options.statementType,
      text:
        options.statementText,
    },
    signer:
      options.signer,
    issued_at:
      options.issuedAt,
    ...(options.metadata === undefined
      ? {}
      : {
          metadata:
            options.metadata,
        }),
  };
}
