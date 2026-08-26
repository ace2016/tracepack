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
  createPackAttestationPolicy,
  createPackAttestationStatement,
  createPackSnapshot,
  packSnapshotToAttestationSubject,
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
          "b".repeat(64),
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
          "a".repeat(64),
        reviewStatus: "reviewed",
        notes: "",
        size: 100,
        mimeType: "application/pdf",
      },
    ],
  };
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
          .contentHash =
          "f".repeat(64);

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
          .contentHash =
          "f".repeat(64);

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
