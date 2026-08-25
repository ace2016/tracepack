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
  "legacy Cosign bundle compatibility",
  () => {
    it(
      "detects the legacy Cosign bundle shape before cryptographic verification",
      async () => {
        const payload =
          new TextEncoder().encode(
            "legacy-cosign-format-detection",
          );

        const legacyBundle = {
          base64Signature:
            "placeholder-signature",
          cert:
            "placeholder-certificate",
          rekorBundle: {
            SignedEntryTimestamp:
              "placeholder-set",
            Payload: {
              body:
                "placeholder-body",
              integratedTime: 1,
              logIndex: 1,
              logID:
                "placeholder-log-id",
            },
          },
        };

        try {
          await verifyWithSigstore(
            payload,
            legacyBundle,
          );

          throw new Error(
            "Expected legacy Cosign bundle rejection.",
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
            expect(
              error.message,
            ).toMatch(
              /Legacy Cosign bundle detected/,
            );

            expect(
              error.report.stages.find(
                (stage) =>
                  stage.id === "bundle",
              )?.status,
            ).toBe("failed");

            expect(
              error.report.stages.find(
                (stage) =>
                  stage.id === "signature",
              )?.status,
            ).toBe("skipped");
          }
        }
      },
    );
  },
);
