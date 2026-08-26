import {
  describe,
  expect,
  it,
} from "vitest";

import {
  canonicalizeJson,
  computeAttestationStatementHash,
  evaluateAttestationPolicy,
  parseSignedAttestation,
  verifySignedAttestation,
} from "../src";

import type {
  AttestationStatementV1,
  AttestationVerificationResultV1,
  SignedAttestationV1,
} from "../src";

const PACK_DIGEST =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function statement(
  partyId: string,
  role: string,
  type: string,
): AttestationStatementV1 {
  return {
    schema_version:
      "tracepack-attestation/v1",
    attestation_id:
      `att-${partyId}-${type}`,
    subject: {
      kind: "tracepack-pack",
      digest: {
        algorithm: "sha256",
        value: PACK_DIGEST,
      },
      pack_version: 4,
    },
    statement: {
      type,
      text: `I attest as ${role}.`,
    },
    signer: {
      party_id: partyId,
      role,
      expected_identity: {
        issuer:
          "https://token.actions.githubusercontent.com",
        subject:
          `https://example.test/${partyId}`,
      },
    },
    issued_at:
      "2026-08-25T15:00:00Z",
  };
}

async function signed(
  value: AttestationStatementV1,
): Promise<SignedAttestationV1> {
  return {
    statement: value,
    signature: {
      method: "sigstore",
      content_digest: {
        algorithm: "sha256",
        value:
          await computeAttestationStatementHash(
            value,
          ),
      },
      bundle_media_type:
        "application/vnd.dev.sigstore.bundle+json;version=0.3",
      bundle: {
        mediaType:
          "application/vnd.dev.sigstore.bundle+json;version=0.3",
      },
    },
  };
}

describe(
  "tracepack-attestation v1",
  () => {
    it(
      "hashes canonical statement content deterministically",
      async () => {
        const value = statement(
          "party-a",
          "organisation-signatory",
          "organisation.signoff",
        );

        const first =
          await computeAttestationStatementHash(
            value,
          );

        const second =
          await computeAttestationStatementHash(
            {
              ...value,
              signer: {
                ...value.signer,
              },
            },
          );

        expect(first).toMatch(
          /^[0-9a-f]{64}$/,
        );
        expect(second).toBe(first);
      },
    );

    it(
      "rejects a changed statement when the stored content digest no longer matches",
      async () => {
        const original = statement(
          "party-a",
          "organisation-signatory",
          "organisation.signoff",
        );

        const envelope =
          await signed(original);

        envelope.statement.statement.text =
          "Changed after signing";

        const result =
          await verifySignedAttestation(
            envelope,
            async () => ({
              issuer:
                "https://token.actions.githubusercontent.com",
              subject:
                "https://example.test/party-a",
            }),
          );

        expect(result.valid).toBe(
          false,
        );

        if (!result.valid) {
          expect(result.reason).toBe(
            "content_digest_mismatch",
          );

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "structure",
              )
              ?.status,
          ).toBe("passed");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "canonicalization",
              )
              ?.status,
          ).toBe("passed");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "content_digest",
              )
              ?.status,
          ).toBe("failed");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "content_digest",
              )
              ?.code,
          ).toBe(
            "ATTESTATION_CONTENT_DIGEST_MISMATCH",
          );
        }
      },
    );

    it(
      "binds a verified Sigstore identity to the claimed signer when declared",
      async () => {
        const value = statement(
          "party-a",
          "organisation-signatory",
          "organisation.signoff",
        );

        const envelope =
          await signed(value);

        parseSignedAttestation(
          envelope,
        );

        const result =
          await verifySignedAttestation(
            envelope,
            async () => ({
              issuer:
                "https://token.actions.githubusercontent.com",
              subject:
                "https://example.test/party-a",
            }),
          );

        expect(result.valid).toBe(true);

        if (result.valid) {
          expect(
            result.identity_binding,
          ).toBe("matched");
        }
      },
    );

    it(
      "requires distinct verified parties for multi-party policy",
      async () => {
        const organisation =
          await signed(
            statement(
              "organisation-a",
              "organisation-signatory",
              "organisation.signoff",
            ),
          );

        const reviewer =
          await signed(
            statement(
              "reviewer-a",
              "compliance-reviewer",
              "review.approval",
            ),
          );

        const verified:
          AttestationVerificationResultV1[] =
          [
            {
              valid: true,
              attestation:
                organisation,
              verified_identity: {
                issuer: "issuer",
                subject:
                  "organisation-a",
              },
              identity_binding:
                "matched",
            },
            {
              valid: true,
              attestation: reviewer,
              verified_identity: {
                issuer: "issuer",
                subject:
                  "reviewer-a",
              },
              identity_binding:
                "matched",
            },
          ];

        const result =
          evaluateAttestationPolicy(
            {
              policy_version:
                "tracepack-attestation-policy/v1",
              subject:
                organisation.statement
                  .subject,
              requirements: [
                {
                  id:
                    "organisation-signoff",
                  statement_type:
                    "organisation.signoff",
                  role:
                    "organisation-signatory",
                  minimum_signers: 1,
                  require_identity_binding:
                    true,
                },
                {
                  id:
                    "compliance-review",
                  statement_type:
                    "review.approval",
                  role:
                    "compliance-reviewer",
                  minimum_signers: 1,
                  require_identity_binding:
                    true,
                },
              ],
            },
            verified,
          );

        expect(result.satisfied).toBe(
          true,
        );

        expect(
          result.requirements,
        ).toHaveLength(2);
      },
    );
  },
);



describe(
  "canonical JSON input validation",
  () => {
    it(
      "rejects values that cannot be represented as canonical JSON",
      () => {
        expect(
          () =>
            canonicalizeJson(
              undefined,
            ),
        ).toThrow(
          "Value cannot be represented as canonical JSON.",
        );

        expect(
          () =>
            canonicalizeJson(
              () => undefined,
            ),
        ).toThrow(
          "Value cannot be represented as canonical JSON.",
        );
      },
    );
  },
);

describe(
  "pre-Sigstore validation failures",
  () => {
    it(
      "reports malformed envelope structure failures",
      async () => {
        const result =
          await verifySignedAttestation(
            {
              not:
                "an attestation",
            },
            async () => {
              throw new Error(
                "Sigstore verifier must not run.",
              );
            },
          );

        expect(result.valid).toBe(
          false,
        );

        if (!result.valid) {
          expect(result.reason).toBe(
            "invalid_structure",
          );

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "structure",
              )
              ?.status,
          ).toBe("failed");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "canonicalization",
              )
              ?.status,
          ).toBe("skipped");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "bundle",
              )
              ?.status,
          ).toBe("skipped");
        }
      },
    );
  },
);

describe(
  "attestation JSON schema parity",
  () => {
    it(
      "mirrors organisation id runtime bounds",
      async () => {
        const {
          readFileSync,
        } = await import("node:fs");

        const schema =
          JSON.parse(
            readFileSync(
              new URL(
                "../schema/tracepack-attestation.v1.json",
                import.meta.url,
              ),
              "utf8",
            ),
          );

        const organisationId =
          schema
            .properties
            .statement
            .properties
            .signer
            .properties
            .organisation
            .properties
            .id;

        expect(
          organisationId.minLength,
        ).toBe(1);

        expect(
          organisationId.maxLength,
        ).toBe(512);

        const signer =
          schema
            .properties
            .statement
            .properties
            .signer
            .properties;

        expect(
          signer
            .organisation
            .properties
            .name
            .minLength,
        ).toBe(1);

        expect(
          signer
            .organisation
            .properties
            .name
            .maxLength,
        ).toBe(512);

        expect(
          signer
            .expected_identity
            .properties
            .issuer
            .maxLength,
        ).toBe(2048);

        expect(
          signer
            .expected_identity
            .properties
            .subject
            .maxLength,
        ).toBe(4096);

        expect(
          schema
            .properties
            .signature
            .properties
            .bundle_media_type
            .maxLength,
        ).toBe(512);
      },
    );
  },
);

describe(
  "verification stage reporting",
  () => {
    it(
      "creates verification stages in deterministic order",
      async () => {
        const {
          createVerificationReport,
          VERIFICATION_STAGE_ORDER,
        } = await import("../src");

        const report =
          createVerificationReport();

        expect(
          report.stages.map(
            (stage) => stage.id,
          ),
        ).toEqual(
          VERIFICATION_STAGE_ORDER,
        );

        expect(
          report.stages.every(
            (stage) =>
              stage.status === "pending",
          ),
        ).toBe(true);
      },
    );

    it(
      "records an explicit verification failure",
      async () => {
        const {
          createVerificationReport,
          setVerificationStage,
          verificationStage,
        } = await import("../src");

        const report =
          createVerificationReport();

        setVerificationStage(
          report,
          "certificate",
          "failed",
          {
            code:
              "CERTIFICATE_UNTRUSTED",
            message:
              "Signing certificate is not trusted.",
          },
        );

        expect(
          verificationStage(
            report,
            "certificate",
          ),
        ).toEqual({
          id: "certificate",
          status: "failed",
          code:
            "CERTIFICATE_UNTRUSTED",
          message:
            "Signing certificate is not trusted.",
        });
      },
    );
  },
);


describe(
  "pre-Sigstore report propagation",
  () => {
    it(
      "marks completed structure canonicalization and content digest stages before a Sigstore failure",
      async () => {
        const {
          createVerificationReport,
          setVerificationStage,
        } = await import("../src");

        const value =
          statement(
            "party-a",
            "organisation-signatory",
            "organisation.signoff",
          );

        const envelope =
          await signed(value);

        const result =
          await verifySignedAttestation(
            envelope,
            async () => {
              const report =
                createVerificationReport();

              setVerificationStage(
                report,
                "bundle",
                "failed",
                {
                  code:
                    "SIGSTORE_BUNDLE_INVALID",
                  message:
                    "Fixture bundle rejected.",
                },
              );

              const error =
                Object.assign(
                  new Error(
                    "Fixture bundle rejected.",
                  ),
                  {
                    report,
                  },
                );

              throw error;
            },
          );

        expect(result.valid).toBe(false);

        if (!result.valid) {
          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "structure",
              )
              ?.status,
          ).toBe("passed");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "canonicalization",
              )
              ?.status,
          ).toBe("passed");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "content_digest",
              )
              ?.status,
          ).toBe("passed");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "bundle",
              )
              ?.status,
          ).toBe("failed");
        }
      },
    );
  },
);


describe(
  "identity mismatch reporting",
  () => {
    it(
      "marks identity failed when verified identity does not match the declared identity",
      async () => {
        const {
          createVerificationReport,
          setVerificationStage,
        } = await import("../src");

        const value =
          statement(
            "party-a",
            "organisation-signatory",
            "organisation.signoff",
          );

        const envelope =
          await signed(value);

        const report =
          createVerificationReport();

        for (const stage of [
          "structure",
          "canonicalization",
          "content_digest",
          "bundle",
          "trusted_root",
          "certificate",
          "transparency_log",
          "signature",
          "identity",
          "policy",
        ] as const) {
          setVerificationStage(
            report,
            stage,
            "passed",
          );
        }

        const result =
          await verifySignedAttestation(
            envelope,
            async () => ({
              identity: {
                issuer:
                  "https://token.actions.githubusercontent.com",
                subject:
                  "https://example.test/different-party",
              },
              report,
            }),
          );

        expect(result.valid).toBe(
          false,
        );

        if (!result.valid) {
          expect(
            result.reason,
          ).toBe(
            "identity_mismatch",
          );

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "identity",
              )
              ?.status,
          ).toBe("failed");

          expect(
            result.report
              ?.stages
              .find(
                (stage) =>
                  stage.id ===
                  "identity",
              )
              ?.code,
          ).toBe(
            "ATTESTATION_IDENTITY_MISMATCH",
          );
        }
      },
    );
  },
);


describe(
  "empty attestation policy handling",
  () => {
    it(
      "fails closed when requirements are empty",
      () => {
        const result =
          evaluateAttestationPolicy(
            {
              policy_version:
                "tracepack-attestation-policy/v1",

              subject: {
                kind:
                  "tracepack-pack",

                digest: {
                  algorithm:
                    "sha256",

                  value:
                    PACK_DIGEST,
                },

                pack_version: 4,
              },

              requirements: [],
            },
            [],
          );

        expect(
          result.satisfied,
        ).toBe(false);

        expect(
          result.requirements,
        ).toEqual([]);
      },
    );
  },
);



describe(
  "invalid signer threshold handling",
  () => {
    it.each([
      0,
      -1,
      1.5,
    ])(
      "fails closed for minimum_signers %s",
      (minimumSigners) => {
        const result =
          evaluateAttestationPolicy(
            {
              policy_version:
                "tracepack-attestation-policy/v1",

              subject: {
                kind:
                  "tracepack-pack",

                digest: {
                  algorithm:
                    "sha256",

                  value:
                    PACK_DIGEST,
                },

                pack_version: 4,
              },

              requirements: [
                {
                  id:
                    "invalid-threshold",

                  statement_type:
                    "review.approval",

                  minimum_signers:
                    minimumSigners,
                },
              ],
            },
            [],
          );

        expect(
          result.satisfied,
        ).toBe(false);

        expect(
          result.requirements[0]
            ?.satisfied,
        ).toBe(false);
      },
    );
  },
);

describe(
  "multi-party signer identity uniqueness",
  () => {
    it(
      "does not count one verified identity twice under different party IDs",
      () => {
        const subject = {
          kind:
            "tracepack-pack" as const,
          digest: {
            algorithm:
              "sha256" as const,
            value:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        };

        const makeResult = (
          partyId: string,
        ) => ({
          valid: true as const,
          attestation: {
            statement: {
              schema_version:
                "tracepack-attestation/v1" as const,
              attestation_id:
                `attestation-${partyId}`,
              subject,
              statement: {
                type:
                  "pack.approval",
                text:
                  "Approved",
              },
              signer: {
                party_id:
                  partyId,
                role:
                  "approver",
                expected_identity: {
                  issuer:
                    "https://issuer.example",
                  subject:
                    "https://identity.example/same-signer",
                },
              },
              issued_at:
                "2026-08-26T00:00:00Z",
            },
            signature: {
              method:
                "sigstore" as const,
              content_digest: {
                algorithm:
                  "sha256" as const,
                value:
                  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              },
              bundle_media_type:
                "application/vnd.dev.sigstore.bundle+json;version=0.2",
              bundle: {},
            },
          },
          verified_identity: {
            issuer:
              "https://issuer.example",
            subject:
              "https://identity.example/same-signer",
          },
          identity_binding:
            "matched" as const,
        });

        const result =
          evaluateAttestationPolicy(
            {
              policy_version:
                "tracepack-attestation-policy/v1",
              subject,
              requirements: [
                {
                  id:
                    "two-approvers",
                  statement_type:
                    "pack.approval",
                  role:
                    "approver",
                  minimum_signers:
                    2,
                  require_identity_binding:
                    true,
                },
              ],
            },
            [
              makeResult("party-a"),
              makeResult("party-b"),
            ],
          );

        expect(
          result.satisfied,
        ).toBe(false);

        expect(
          result.requirements[0]
            ?.matched_parties,
        ).toHaveLength(1);
      },
    );
  },
);


describe(
  "verification report propagation",
  () => {
    it(
      "preserves a verifier report on success",
      async () => {
        const value =
          statement(
            "party-report",
            "reviewer",
            "review.approval",
          );

        const envelope =
          await signed(value);

        const report = {
          stages: [
            {
              id:
                "signature" as const,
              status:
                "passed" as const,
            },
          ],
        };

        const result =
          await verifySignedAttestation(
            envelope,
            async () => ({
              identity: {
                issuer:
                  "https://token.actions.githubusercontent.com",
                subject:
                  "https://example.test/party-report",
              },
              report,
            }),
          );

        expect(
          result.report,
        ).toEqual(report);
      },
    );

    it(
      "preserves a verifier report on failure",
      async () => {
        const value =
          statement(
            "party-report-failure",
            "reviewer",
            "review.approval",
          );

        const envelope =
          await signed(value);

        const report = {
          stages: [
            {
              id:
                "signature" as const,
              status:
                "failed" as const,
              code:
                "TEST_SIGNATURE_FAILURE",
            },
          ],
        };

        const result =
          await verifySignedAttestation(
            envelope,
            async () => {
              const error =
                new Error(
                  "Signature failed",
                ) as Error & {
                  report:
                    typeof report;
                };

              error.report =
                report;

              throw error;
            },
          );

        expect(
          result.valid,
        ).toBe(false);

        expect(
          result.report,
        ).toEqual(report);
      },
    );
  },
);
