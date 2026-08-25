import {
  describe,
  expect,
  it,
} from "vitest";

import {
  SigstoreVerificationError,
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
  },
);
