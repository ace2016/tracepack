import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  SigstoreVerificationError,
  verifyWithSigstore,
} from "../src";

const PAYLOAD =
  "/tmp/tracepack-sigstore-real/tracepack-evidence-core-0.2.1.tgz";

const BUNDLE =
  "/tmp/tracepack-sigstore-real/tracepack-evidence-core-0.2.1.tgz.sigstore.json";

describe(
  "existing TracePack release compatibility",
  () => {
    it(
      "detects the developer-v0.2.1 release bundle as legacy Cosign format",
      async () => {
        const payload =
          readFileSync(PAYLOAD);

        const bundle =
          JSON.parse(
            readFileSync(
              BUNDLE,
              "utf8",
            ),
          );

        try {
          await verifyWithSigstore(
            payload,
            bundle,
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
