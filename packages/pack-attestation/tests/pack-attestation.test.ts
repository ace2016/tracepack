import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  TracepackProject,
} from "@tracepack/evidence-core";

import {
  computePackSnapshotDigest,
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
      categories: [],
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

describe(
  "TracePack pack attestation integration",
  () => {
    it(
      "creates the same digest regardless of evidence input order",
      async () => {
        const first = project();
        const second = project();

        second.evidence.reverse();

        expect(
          await computePackSnapshotDigest(
            createPackSnapshot(first, 1),
          ),
        ).toBe(
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
      "ignores mutable project timestamps and narrative fields",
      async () => {
        const before = project();
        const after = project();

        after.updatedAt =
          "2026-09-01T12:00:00Z";

        after.summary =
          "Edited working summary.";

        after.desiredResolution =
          "Edited working resolution.";

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
