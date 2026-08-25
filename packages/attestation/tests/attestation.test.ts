import {
  describe,
  expect,
  it,
} from "vitest";

import {
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

        expect(result).toEqual({
          valid: false,
          reason:
            "content_digest_mismatch",
        });
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
