import {
  readFileSync,
} from "node:fs";

import {
  fileURLToPath,
} from "node:url";

import {
  dirname,
  join,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  verifyWithSigstore,
} from "../src";

const here =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const payload =
  readFileSync(
    join(
      here,
      "fixtures",
      "github-actions-payload.txt",
    ),
  );

const bundle =
  JSON.parse(
    readFileSync(
      join(
        here,
        "fixtures",
        "github-actions-bundle.sigstore.json",
      ),
      "utf8",
    ),
  );

const issuer =
  "https://token.actions.githubusercontent.com";

const subject =
  "https://github.com/ace2016/tracepack/.github/workflows/generate-attestation-fixture.yml@refs/pull/20/merge";

function stageStatus(
  error: unknown,
  id: string,
): string | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("report" in error)
  ) {
    return undefined;
  }

  const report =
    (
      error as {
        report?: {
          stages?: Array<{
            id: string;
            status: string;
          }>;
        };
      }
    ).report;

  return report
    ?.stages
    ?.find(
      (stage) =>
        stage.id === id,
    )
    ?.status;
}

describe(
  "real Sigstore GitHub Actions fixture",
  () => {
    it(
      "verifies the original payload cryptographically",
      async () => {
        const result =
          await verifyWithSigstore(
            payload,
            bundle,
          );

        expect(
          result.identity.issuer,
        ).toBe(issuer);

        expect(
          result.identity.subject,
        ).toBe(subject);

        expect(
          result.report.stages.find(
            (stage) =>
              stage.id ===
              "signature",
          )?.status,
        ).toBe("passed");
      },
    );

    it(
      "rejects a tampered payload as a signature failure",
      async () => {
        const tampered =
          Buffer.from(
            "tracepack-attestation-sigstore-fixture-v1-tampered",
          );

        try {
          await verifyWithSigstore(
            tampered,
            bundle,
          );

          throw new Error(
            "Expected cryptographic verification failure",
          );
        } catch (error) {
          expect(
            stageStatus(
              error,
              "signature",
            ),
          ).toBe("failed");

          expect(
            stageStatus(
              error,
              "identity",
            ),
          ).toBe("skipped");

          expect(
            stageStatus(
              error,
              "policy",
            ),
          ).toBe("skipped");
        }
      },
    );

    it(
      "accepts the verified issuer and subject policy",
      async () => {
        const result =
          await verifyWithSigstore(
            payload,
            bundle,
            {
              certificateIssuer:
                issuer,

              certificateIdentityURI:
                subject,
            },
          );

        expect(
          result.identity.issuer,
        ).toBe(issuer);

        expect(
          result.identity.subject,
        ).toBe(subject);

        expect(
          result.report.stages.find(
            (stage) =>
              stage.id ===
              "policy",
          )?.status,
        ).toBe("passed");
      },
    );

    it(
      "classifies the wrong certificate issuer as a policy failure",
      async () => {
        try {
          await verifyWithSigstore(
            payload,
            bundle,
            {
              certificateIssuer:
                "https://issuer.example.invalid",

              certificateIdentityURI:
                subject,
            },
          );

          throw new Error(
            "Expected identity policy rejection",
          );
        } catch (error) {
          expect(
            stageStatus(
              error,
              "signature",
            ),
          ).toBe("passed");

          expect(
            stageStatus(
              error,
              "identity",
            ),
          ).toBe("passed");

          expect(
            stageStatus(
              error,
              "policy",
            ),
          ).toBe("failed");
        }
      },
    );

    it(
      "classifies the wrong certificate identity URI as a policy failure",
      async () => {
        try {
          await verifyWithSigstore(
            payload,
            bundle,
            {
              certificateIssuer:
                issuer,

              certificateIdentityURI:
                "https://github.com/example/example/.github/workflows/sign.yml@refs/heads/main",
            },
          );

          throw new Error(
            "Expected identity policy rejection",
          );
        } catch (error) {
          expect(
            stageStatus(
              error,
              "signature",
            ),
          ).toBe("passed");

          expect(
            stageStatus(
              error,
              "identity",
            ),
          ).toBe("passed");

          expect(
            stageStatus(
              error,
              "policy",
            ),
          ).toBe("failed");
        }
      },
    );
  },
);


describe(
  "policy failure classification",
  () => {
    it(
      "reports a wrong issuer as policy failure rather than signature failure",
      async () => {
        try {
          await verifyWithSigstore(
            payload,
            bundle,
            {
              certificateIssuer:
                "https://issuer.example.invalid",
              certificateIdentityURI:
                subject,
            },
          );

          throw new Error(
            "Expected policy rejection",
          );
        } catch (error) {
          const report =
            (
              error as {
                report?: {
                  stages: Array<{
                    id: string;
                    status: string;
                  }>;
                };
              }
            ).report;

          expect(report).toBeDefined();

          expect(
            report?.stages.find(
              (stage) =>
                stage.id === "signature",
            )?.status,
          ).toBe("passed");

          expect(
            report?.stages.find(
              (stage) =>
                stage.id === "identity",
            )?.status,
          ).toBe("passed");

          expect(
            report?.stages.find(
              (stage) =>
                stage.id === "policy",
            )?.status,
          ).toBe("failed");
        }
      },
    );

    it(
      "reports a wrong subject as policy failure rather than signature failure",
      async () => {
        try {
          await verifyWithSigstore(
            payload,
            bundle,
            {
              certificateIssuer:
                issuer,
              certificateIdentityURI:
                "https://github.com/example/example/.github/workflows/sign.yml@refs/heads/main",
            },
          );

          throw new Error(
            "Expected policy rejection",
          );
        } catch (error) {
          const report =
            (
              error as {
                report?: {
                  stages: Array<{
                    id: string;
                    status: string;
                  }>;
                };
              }
            ).report;

          expect(report).toBeDefined();

          expect(
            report?.stages.find(
              (stage) =>
                stage.id === "signature",
            )?.status,
          ).toBe("passed");

          expect(
            report?.stages.find(
              (stage) =>
                stage.id === "identity",
            )?.status,
          ).toBe("passed");

          expect(
            report?.stages.find(
              (stage) =>
                stage.id === "policy",
            )?.status,
          ).toBe("failed");
        }
      },
    );
  },
);
