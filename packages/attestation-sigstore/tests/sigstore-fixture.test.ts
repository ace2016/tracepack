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
      },
    );

    it(
      "rejects a tampered payload",
      async () => {
        const tampered =
          Buffer.from(
            "tracepack-attestation-sigstore-fixture-v1-tampered",
          );

        await expect(
          verifyWithSigstore(
            tampered,
            bundle,
          ),
        ).rejects.toThrow();
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
      },
    );

    it(
      "rejects the wrong certificate issuer",
      async () => {
        await expect(
          verifyWithSigstore(
            payload,
            bundle,
            {
              certificateIssuer:
                "https://issuer.example.invalid",
              certificateIdentityURI:
                subject,
            },
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects the wrong certificate identity URI",
      async () => {
        await expect(
          verifyWithSigstore(
            payload,
            bundle,
            {
              certificateIssuer:
                issuer,
              certificateIdentityURI:
                "https://github.com/example/example/.github/workflows/sign.yml@refs/heads/main",
            },
          ),
        ).rejects.toThrow();
      },
    );
  },
);
