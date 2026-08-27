import {
  describe,
  expect,
  it,
} from "vitest";

import {
  computeAttestationStatementHash,
  evaluateAttestationPolicy,
  verifySignedAttestation,
} from "@tracepack/attestation";

import type {
  AttestationStatementV1,
  SignedAttestationV1,
} from "@tracepack/attestation";

import type {
  TracepackProject,
} from "@tracepack/evidence-core";

import {
  computePackSnapshotDigest,
  createPackAttestationPolicy as createPackAttestationPolicyWithFiles,
  createPackAttestationStatement as createPackAttestationStatementWithFiles,
  createPackSnapshot,
  packSnapshotToAttestationSubject as packSnapshotToAttestationSubjectWithFiles,
} from "../src/index.js";

function project(): TracepackProject {
  return {
    id: "project-1",
    schemaVersion: 1,
    title: "Deposit dispute",
    organisation: "Example Lettings",
    summary: "Deposit not returned.",
    desiredResolution: "Return the deposit.",
    createdAt: "2026-08-26T10:00:00Z",
    updatedAt: "2026-08-26T11:00:00Z",

    template: {
      id: "deposit-dispute",
      name: "Deposit dispute",
      version: "1.0.0",
      jurisdiction: "GB",
      categories: [
        {
          id: "agreement",
          name: "Agreement",
          requirement: "optional",
          description: "",
          acceptedTypes: [],
        },
        {
          id: "condition",
          name: "Condition",
          requirement: "optional",
          description: "",
          acceptedTypes: [],
        },
      ],
      exportSections: [],
    },

    evidence: [
      {
        id: "evidence-b",
        projectId: "project-1",
        title: "Checkout photos",
        categoryId: "condition",
        sourceType: "image",
        importedAt:
          "2026-08-26T10:30:00Z",
        contentHash:
          "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c",
        reviewStatus: "reviewed",
        notes: "",
        size: 200,
        mimeType: "image/jpeg",
      },
      {
        id: "evidence-a",
        projectId: "project-1",
        title: "Tenancy agreement",
        categoryId: "agreement",
        sourceType: "pdf",
        importedAt:
          "2026-08-26T10:20:00Z",
        contentHash:
          "29d1283686193dc1461a7deac4f53d9bc5402a28b95d854f69e94986756fd0a9",
        reviewStatus: "reviewed",
        notes: "",
        size: 100,
        mimeType: "application/pdf",
      },
    ],
  };
}

function projectFiles(): Map<string, Blob> {
  return new Map([
    [
      "evidence-b",
      new Blob(
        ["image-bytes"],
        {
          type: "image/jpeg",
        },
      ),
    ],
    [
      "evidence-a",
      new Blob(
        ["pdf-bytes"],
        {
          type: "application/pdf",
        },
      ),
    ],
  ]);
}

function packSnapshotToAttestationSubject(
  snapshot:
    Parameters<
      typeof packSnapshotToAttestationSubjectWithFiles
    >[0],
) {
  return packSnapshotToAttestationSubjectWithFiles(
    snapshot,
    projectFiles(),
  );
}

function createPackAttestationStatement(
  snapshot:
    Parameters<
      typeof createPackAttestationStatementWithFiles
    >[0],
  options:
    Parameters<
      typeof createPackAttestationStatementWithFiles
    >[2],
) {
  return createPackAttestationStatementWithFiles(
    snapshot,
    projectFiles(),
    options,
  );
}

function createPackAttestationPolicy(
  snapshot:
    Parameters<
      typeof createPackAttestationPolicyWithFiles
    >[0],
  requirements:
    Parameters<
      typeof createPackAttestationPolicyWithFiles
    >[2],
) {
  return createPackAttestationPolicyWithFiles(
    snapshot,
    projectFiles(),
    requirements,
  );
}

async function signedEnvelope(
  statement: AttestationStatementV1,
): Promise<SignedAttestationV1> {
  return {
    statement,
    signature: {
      method: "sigstore",
      content_digest: {
        algorithm: "sha256",
        value:
          await computeAttestationStatementHash(
            statement,
          ),
      },
      bundle_media_type:
        "application/vnd.dev.sigstore.bundle+json;version=0.3",
      bundle: {},
    },
  };
}

describe(
  "TracePack pack attestation integration",
  () => {
    it(
      "changes the digest when finalized evidence order changes",
      async () => {
        const first = project();
        const second = project();

        second.evidence.reverse();

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(first, 1),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(second, 1),
          ),
        );
      },
    );

    it(
      "changes the digest when evidence content changes",
      async () => {
        const before = project();
        const after = project();

        after.evidence[0]!.contentHash =
          "c".repeat(64);

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(after, 1),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(before, 1),
          ),
        );
      },
    );

    it(
      "changes the digest when evidence is added or removed",
      async () => {
        const full = project();
        const reduced = project();

        reduced.evidence.pop();

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(full, 1),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(reduced, 1),
          ),
        );
      },
    );

    it(
      "changes the digest when the template version changes",
      async () => {
        const before = project();
        const after = project();

        after.template.version =
          "2.0.0";

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(before, 1),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(after, 1),
          ),
        );
      },
    );

    it(
      "binds the digest and pack version into an attestation subject",
      async () => {
        const subject =
          await packSnapshotToAttestationSubject(
            createPackSnapshot(
              project(),
              3,
            ),
          );

        expect(subject.kind).toBe(
          "tracepack-pack",
        );

        expect(
          subject.digest.algorithm,
        ).toBe("sha256");

        expect(
          subject.digest.value,
        ).toMatch(
          /^[0-9a-f]{64}$/,
        );

        expect(
          subject.pack_version,
        ).toBe(3);
      },
    );

    it(
      "changes the binding between pack versions",
      async () => {
        const current =
          project();

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(
              current,
              1,
            ),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(
              current,
              2,
            ),
          ),
        );
      },
    );

    it(
      "ignores mutable project timestamps",
      async () => {
        const before = project();
        const after = project();

        after.updatedAt =
          "2026-09-01T12:00:00Z";

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(before, 1),
          ),
        ).toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(after, 1),
          ),
        );
      },
    );

    it(
      "changes the digest when rendered project summary changes",
      async () => {
        const before = project();
        const after = project();

        after.summary =
          "Edited pack summary.";

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(before, 1),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(after, 1),
          ),
        );
      },
    );

    it(
      "changes the digest when evidence review status changes",
      async () => {
        const before = project();
        const after = project();

        after.evidence[0]!.reviewStatus =
          "excluded";

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(before, 1),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(after, 1),
          ),
        );
      },
    );

    it(
      "does not bind excluded evidence into the finalized pack snapshot",
      async () => {
        const before = project();
        const after = project();

        after.evidence[0]!.reviewStatus =
          "excluded";

        const excludedChanged =
          project();

        excludedChanged.evidence[0]!
          .reviewStatus =
          "excluded";

        excludedChanged.evidence[0]!
          .contentHash =
          "f".repeat(64);

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(after, 1),
          ),
        ).toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(
              excludedChanged,
              1,
            ),
          ),
        );

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(before, 1),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(after, 1),
          ),
        );
      },
    );

    it(
      "changes the digest when a rendered category name changes",
      async () => {
        const before = project();
        const after = project();

        after.template.categories = [
          {
            id: "agreement",
            name: "Agreement updated",
            requirement: "optional",
            description: "",
            acceptedTypes: [],
          },
          {
            id: "condition",
            name: "Condition",
            requirement: "optional",
            description: "",
            acceptedTypes: [],
          },
        ];

        before.template.categories = [
          {
            id: "agreement",
            name: "Agreement",
            requirement: "optional",
            description: "",
            acceptedTypes: [],
          },
          {
            id: "condition",
            name: "Condition",
            requirement: "optional",
            description: "",
            acceptedTypes: [],
          },
        ];

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(before, 1),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(after, 1),
          ),
        );
      },
    );

    it(
      "rejects duplicate evidence IDs",
      () => {
        const duplicate =
          project();

        duplicate.evidence[1]!.id =
          duplicate.evidence[0]!.id;

        expect(
          () =>
            createPackSnapshot(
              duplicate,
              1,
            ),
        ).toThrow(
          "Duplicate evidence id:",
        );
      },
    );

    it(
      "creates an attestation statement bound to the exact pack subject",
      async () => {
        const snapshot =
          createPackSnapshot(
            project(),
            7,
          );

        const expectedSubject =
          await packSnapshotToAttestationSubject(
            snapshot,
          );

        const statement =
          await createPackAttestationStatement(
            snapshot,
            {
              attestationId:
                "attestation-1",
              statementType:
                "approval",
              statementText:
                "I approve this pack.",
              issuedAt:
                "2026-08-26T14:30:00Z",
              signer: {
                party_id:
                  "reviewer-1",
                display_name:
                  "Reviewer One",
                role:
                  "reviewer",
              },
            },
          );

        expect(
          statement.schema_version,
        ).toBe(
          "tracepack-attestation/v1",
        );

        expect(
          statement.subject,
        ).toEqual(
          expectedSubject,
        );

        expect(
          statement.subject.pack_version,
        ).toBe(7);

        expect(
          statement.statement.type,
        ).toBe("approval");

        expect(
          statement.signer.party_id,
        ).toBe(
          "reviewer-1",
        );
      },
    );

    it(
      "changes the attestation subject when the finalized pack changes",
      async () => {
        const before =
          project();

        const after =
          project();

        after.evidence[0]!
          .title =
          "Checkout photos updated";

        const beforeStatement =
          await createPackAttestationStatement(
            createPackSnapshot(
              before,
              1,
            ),
            {
              attestationId:
                "attestation-before",
              statementType:
                "approval",
              statementText:
                "Approved.",
              issuedAt:
                "2026-08-26T14:30:00Z",
              signer: {
                party_id:
                  "reviewer-1",
              },
            },
          );

        const afterStatement =
          await createPackAttestationStatement(
            createPackSnapshot(
              after,
              1,
            ),
            {
              attestationId:
                "attestation-after",
              statementType:
                "approval",
              statementText:
                "Approved.",
              issuedAt:
                "2026-08-26T14:30:00Z",
              signer: {
                party_id:
                  "reviewer-1",
              },
            },
          );

        expect(
          beforeStatement
            .subject.digest.value,
        ).not.toBe(
          afterStatement
            .subject.digest.value,
        );
      },
    );

    it(
      "changes the attestation subject between pack versions",
      async () => {
        const source =
          project();

        const versionOne =
          await createPackAttestationStatement(
            createPackSnapshot(
              source,
              1,
            ),
            {
              attestationId:
                "attestation-v1",
              statementType:
                "approval",
              statementText:
                "Approved.",
              issuedAt:
                "2026-08-26T14:30:00Z",
              signer: {
                party_id:
                  "reviewer-1",
              },
            },
          );

        const versionTwo =
          await createPackAttestationStatement(
            createPackSnapshot(
              source,
              2,
            ),
            {
              attestationId:
                "attestation-v2",
              statementType:
                "approval",
              statementText:
                "Approved.",
              issuedAt:
                "2026-08-26T14:30:00Z",
              signer: {
                party_id:
                  "reviewer-1",
              },
            },
          );

        expect(
          versionOne
            .subject.digest.value,
        ).not.toBe(
          versionTwo
            .subject.digest.value,
        );

        expect(
          versionOne
            .subject.pack_version,
        ).toBe(1);

        expect(
          versionTwo
            .subject.pack_version,
        ).toBe(2);
      },
    );

    it(
      "accepts a verified attestation for the exact finalized pack",
      async () => {
        const snapshot =
          createPackSnapshot(
            project(),
            1,
          );

        const statement =
          await createPackAttestationStatement(
            snapshot,
            {
              attestationId:
                "approval-pack-v1",
              statementType:
                "approval",
              statementText:
                "Approved.",
              issuedAt:
                "2026-08-26T15:00:00Z",
              signer: {
                party_id:
                  "reviewer-1",
              },
            },
          );

        const verified =
          await verifySignedAttestation(
            await signedEnvelope(
              statement,
            ),
            async () => ({
              issuer:
                "https://token.actions.githubusercontent.com",
              subject:
                "reviewer@example.test",
            }),
          );

        expect(
          verified.valid,
        ).toBe(true);

        const policy =
          await createPackAttestationPolicy(
            snapshot,
            [
              {
                id:
                  "approval",
                statement_type:
                  "approval",
                minimum_signers:
                  1,
              },
            ],
          );

        const result =
          evaluateAttestationPolicy(
            policy,
            [verified],
          );

        expect(
          result.satisfied,
        ).toBe(true);
      },
    );

    it(
      "does not accept a pack v1 attestation for pack v2",
      async () => {
        const source =
          project();

        const versionOne =
          createPackSnapshot(
            source,
            1,
          );

        const versionTwo =
          createPackSnapshot(
            source,
            2,
          );

        const statement =
          await createPackAttestationStatement(
            versionOne,
            {
              attestationId:
                "approval-pack-v1",
              statementType:
                "approval",
              statementText:
                "Approved.",
              issuedAt:
                "2026-08-26T15:00:00Z",
              signer: {
                party_id:
                  "reviewer-1",
              },
            },
          );

        const verified =
          await verifySignedAttestation(
            await signedEnvelope(
              statement,
            ),
            async () => ({
              issuer:
                "https://token.actions.githubusercontent.com",
              subject:
                "reviewer@example.test",
            }),
          );

        expect(
          verified.valid,
        ).toBe(true);

        const versionTwoPolicy =
          await createPackAttestationPolicy(
            versionTwo,
            [
              {
                id:
                  "approval",
                statement_type:
                  "approval",
                minimum_signers:
                  1,
              },
            ],
          );

        const result =
          evaluateAttestationPolicy(
            versionTwoPolicy,
            [verified],
          );

        expect(
          result.satisfied,
        ).toBe(false);

        expect(
          result.requirements[0]
            ?.matched_parties,
        ).toEqual([]);
      },
    );

    it(
      "does not accept an attestation after finalized evidence changes",
      async () => {
        const before =
          project();

        const after =
          project();

        after.evidence[0]!
          .title =
          "Checkout photos updated";

        const beforeSnapshot =
          createPackSnapshot(
            before,
            1,
          );

        const afterSnapshot =
          createPackSnapshot(
            after,
            1,
          );

        const statement =
          await createPackAttestationStatement(
            beforeSnapshot,
            {
              attestationId:
                "approval-before-change",
              statementType:
                "approval",
              statementText:
                "Approved.",
              issuedAt:
                "2026-08-26T15:00:00Z",
              signer: {
                party_id:
                  "reviewer-1",
              },
            },
          );

        const verified =
          await verifySignedAttestation(
            await signedEnvelope(
              statement,
            ),
            async () => ({
              issuer:
                "https://token.actions.githubusercontent.com",
              subject:
                "reviewer@example.test",
            }),
          );

        expect(
          verified.valid,
        ).toBe(true);

        const changedPackPolicy =
          await createPackAttestationPolicy(
            afterSnapshot,
            [
              {
                id:
                  "approval",
                statement_type:
                  "approval",
                minimum_signers:
                  1,
              },
            ],
          );

        expect(
          evaluateAttestationPolicy(
            changedPackPolicy,
            [verified],
          ).satisfied,
        ).toBe(false);
      },
    );

    it(
      "changes the digest when evidence MIME type changes",
      async () => {
        const before =
          project();

        const after =
          project();

        after.evidence[0]!.mimeType =
          "image/webp";

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(
              before,
              1,
            ),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(
              after,
              1,
            ),
          ),
        );
      },
    );

    it(
      "binds export-relevant privacy redaction and observation inputs",
      async () => {
        const before =
          project();

        before.evidence[0]!
          .privacyFindings = [
            {
              id: "privacy-1",
              kind: "email",
              label: "Email address",
              value: "a@example.test",
              excerpt:
                "Contact a@example.test",
              decision: "remove",
              field: "title",
            },
          ];

        before.evidence[0]!
          .manualRedactions = [
            {
              id: "region-1",
              kind: "image-region",
              x: 0.1,
              y: 0.2,
              width: 0.3,
              height: 0.1,
              decision: "remove",
              createdAt:
                "2026-08-26T15:00:00Z",
            },
          ];

        before.evidence[0]!
          .provenance = {
            producerId:
              "producer-1",
            producerName:
              "Example Producer",
            producerVersion:
              "1.0.0",
            schemaVersion: 1,
            capturedAt:
              "2026-08-26T14:00:00Z",
          };

        before.evidence[0]!
          .observations = [
            {
              id: "observation-1",
              kind: "claim",
              label: "Reported issue",
              detail:
                "Deposit not returned.",
              confidence: 0.9,
              data: {
                source: "producer",
              },
            },
          ];

        const after =
          structuredClone(before);

        after.evidence[0]!
          .manualRedactions![0]!
          .decision = "keep";

        after.evidence[0]!
          .observations![0]!
          .detail =
          "Deposit partially returned.";

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(
              before,
              1,
            ),
          ),
        ).not.toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(
              after,
              1,
            ),
          ),
        );
      },
    );

    it(
      "detaches nested export inputs from the mutable project",
      async () => {
        const source =
          project();

        source.evidence[0]!
          .privacyFindings = [
            {
              id: "privacy-1",
              kind: "email",
              label: "Email address",
              value: "a@example.test",
              excerpt:
                "Contact a@example.test",
              decision: "remove",
              field: "title",
            },
          ];

        source.evidence[0]!
          .manualRedactions = [
            {
              id: "region-1",
              kind: "image-region",
              x: 0.1,
              y: 0.2,
              width: 0.3,
              height: 0.1,
              decision: "remove",
              createdAt:
                "2026-08-26T15:00:00Z",
            },
          ];

        source.evidence[0]!
          .provenance = {
            producerId:
              "producer-1",
            producerName:
              "Example Producer",
            schemaVersion: 1,
            capturedAt:
              "2026-08-26T14:00:00Z",
          };

        source.evidence[0]!
          .observations = [
            {
              id: "observation-1",
              kind: "claim",
              label: "Reported issue",
              detail:
                "Deposit not returned.",
              data: {
                nested: {
                  value: "original",
                },
              },
            },
          ];

        const snapshot =
          createPackSnapshot(
            source,
            1,
          );

        const digestBefore =
          await computePackSnapshotDigest(
            snapshot,
          );

        source.evidence[0]!
          .privacyFindings![0]!
          .decision = "keep";

        source.evidence[0]!
          .manualRedactions![0]!
          .x = 0.9;

        source.evidence[0]!
          .provenance!
          .producerName =
          "Changed Producer";

        const nested =
          source.evidence[0]!
            .observations![0]!
            .data!.nested as {
              value: string;
            };

        nested.value = "changed";

        const digestAfter =
          await computePackSnapshotDigest(
            snapshot,
          );

        expect(
          digestAfter,
        ).toBe(
          digestBefore,
        );

        expect(
          snapshot.evidence[0]!
            .privacy_findings[0]!
            .decision,
        ).toBe("remove");

        expect(
          snapshot.evidence[0]!
            .manual_redactions[0]!
            .x,
        ).toBe(0.1);

        expect(
          snapshot.evidence[0]!
            .provenance!
            .producer_name,
        ).toBe(
          "Example Producer",
        );

        expect(
          snapshot.evidence[0]!
            .observations[0]!
            .data,
        ).toEqual({
          nested: {
            value: "original",
          },
        });
      },
    );

    it(
      "rejects an attestation subject when included evidence bytes are missing",
      async () => {
        const files =
          projectFiles();

        files.delete(
          "evidence-a",
        );

        await expect(
          packSnapshotToAttestationSubjectWithFiles(
            createPackSnapshot(
              project(),
              1,
            ),
            files,
          ),
        ).rejects.toThrow(
          "Missing evidence bytes for included item: evidence-a",
        );
      },
    );

    it(
      "rejects an attestation subject when evidence bytes do not match contentHash",
      async () => {
        const files =
          projectFiles();

        files.set(
          "evidence-b",
          new Blob(
            ["tampered-image-bytes"],
            {
              type:
                "image/jpeg",
            },
          ),
        );

        await expect(
          packSnapshotToAttestationSubjectWithFiles(
            createPackSnapshot(
              project(),
              1,
            ),
            files,
          ),
        ).rejects.toThrow(
          "Evidence bytes do not match contentHash for included item: evidence-b",
        );
      },
    );

    it(
      "accepts an attestation subject when every included blob matches contentHash",
      async () => {
        const subject =
          await packSnapshotToAttestationSubjectWithFiles(
            createPackSnapshot(
              project(),
              1,
            ),
            projectFiles(),
          );

        expect(
          subject.kind,
        ).toBe(
          "tracepack-pack",
        );
      },
    );

    it(
      "does not require bytes for excluded evidence",
      async () => {
        const source =
          project();

        source.evidence[0]!
          .reviewStatus =
          "excluded";

        const files =
          projectFiles();

        files.delete(
          "evidence-b",
        );

        const subject =
          await packSnapshotToAttestationSubjectWithFiles(
            createPackSnapshot(
              source,
              1,
            ),
            files,
          );

        expect(
          subject.kind,
        ).toBe(
          "tracepack-pack",
        );
      },
    );

    it(
      "uses one fixed snapshot across asynchronous evidence verification",
      async () => {
        const snapshot =
          createPackSnapshot(
            project(),
            1,
          );

        let releaseRead:
          (() => void) | undefined;

        const readGate =
          new Promise<void>(
            (resolve) => {
              releaseRead =
                resolve;
            },
          );

        const files =
          projectFiles();

        const original =
          files.get(
            "evidence-b",
          )!;

        const delayedBlob = {
          arrayBuffer:
            async () => {
              await readGate;
              return original.arrayBuffer();
            },
        } as Blob;

        files.set(
          "evidence-b",
          delayedBlob,
        );

        const pending =
          packSnapshotToAttestationSubjectWithFiles(
            snapshot,
            files,
          );

        snapshot.pack_version = 99;
        snapshot.evidence[0]!
          .content_hash =
          "f".repeat(64);

        releaseRead!();

        const subject =
          await pending;

        expect(
          subject.pack_version,
        ).toBe(1);

        expect(
          subject.digest.value,
        ).toBe(
          await computePackSnapshotDigest(
            createPackSnapshot(
              project(),
              1,
            ),
          ),
        );
      },
    );

    it(
      "rejects invalid pack versions",
      () => {
        for (
          const version of [
            0,
            -1,
            1.5,
            Number.MAX_SAFE_INTEGER + 1,
          ]
        ) {
          expect(
            () =>
              createPackSnapshot(
                project(),
                version,
              ),
          ).toThrow(
            "packVersion must be a positive safe integer.",
          );
        }
      },
    );
  },
);
