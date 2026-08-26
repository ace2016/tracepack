import {
  describe,
  expect,
  it,
} from "vitest";

import {
  computeAttestationStatementHash,
} from "@tracepack/attestation";

import {
  SigstoreVerificationError,
  signAttestationWithSigstore,
  verifyAttestationWithSigstore,
  verifyWithSigstore,
} from "../src";

describe(
  "@tracepack/attestation-sigstore",
  () => {
    it(
      "rejects a structurally invalid Sigstore bundle before signature verification",
      async () => {
        try {
          await verifyWithSigstore(
            new TextEncoder().encode(
              "not signed",
            ),
            {
              mediaType:
                "application/vnd.dev.sigstore.bundle+json;version=0.3",
            },
          );

          throw new Error(
            "Expected verification to fail.",
          );
        } catch (error) {
          expect(
            error,
          ).toBeInstanceOf(
            SigstoreVerificationError,
          );

          if (
            error instanceof
            SigstoreVerificationError
          ) {
            const bundle =
              error.report.stages.find(
                (stage) =>
                  stage.id === "bundle",
              );

            const signature =
              error.report.stages.find(
                (stage) =>
                  stage.id ===
                  "signature",
              );

            expect(
              bundle?.status,
            ).toBe("failed");

            expect(
              bundle?.code,
            ).toBe(
              "SIGSTORE_BUNDLE_INVALID",
            );

            expect(
              signature?.status,
            ).toBe("skipped");
          }
        }
      },
    );

    it(
      "rejects contradictory envelope and embedded bundle media types",
      async () => {
        const statement = {
          schema_version:
            "tracepack-attestation/v1" as const,

          attestation_id:
            "media-type-mismatch",

          subject: {
            kind:
              "tracepack-pack" as const,

            digest: {
              algorithm:
                "sha256" as const,

              value:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },

            pack_version: 1,
          },

          statement: {
            type:
              "pack.approval",

            text:
              "Media type mismatch regression",
          },

          signer: {
            party_id:
              "fixture-signer",
          },

          issued_at:
            "2026-08-26T00:00:00Z",
        };

        const digest =
          await computeAttestationStatementHash(
            statement,
          );

        const result =
          await verifyAttestationWithSigstore(
            {
              statement,

              signature: {
                method:
                  "sigstore",

                content_digest: {
                  algorithm:
                    "sha256",

                  value:
                    digest,
                },

                bundle_media_type:
                  "application/vnd.dev.sigstore.bundle+json;version=0.3",

                bundle: {
                  mediaType:
                    "application/vnd.dev.sigstore.bundle+json;version=0.2",

                  verificationMaterial: {},
                },
              },
            },
          );

        expect(result.valid).toBe(
          false,
        );

        if (!result.valid) {
          expect(
            result.errors?.[0],
          ).toContain(
            "Sigstore bundle media type mismatch",
          );
        }
      },
    );


    it(
      "returns a detached snapshot of the statement being signed",
      async () => {
        const statement = {
          schema_version:
            "tracepack-attestation/v1" as const,
          attestation_id:
            "snapshot-test",
          subject: {
            kind:
              "tracepack-pack" as const,
            digest: {
              algorithm:
                "sha256" as const,
              value:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            pack_version: 1,
          },
          statement: {
            type:
              "pack.approval",
            text:
              "Original text",
          },
          signer: {
            party_id:
              "snapshot-signer",
          },
          issued_at:
            "2026-08-26T00:00:00Z",
        };

        const signing =
          signAttestationWithSigstore(
            statement,
          );

        statement.statement.text =
          "Changed by caller";

        let signed:
          Awaited<
            ReturnType<
              typeof signAttestationWithSigstore
            >
          >;

        try {
          signed = await signing;
        } catch {
          return;
        }

        expect(
          signed.statement,
        ).not.toBe(statement);

        expect(
          signed.statement.statement.text,
        ).toBe("Original text");
      },
    );

  },
);
