import {
  mkdirSync,
  writeFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

import type {
  AttestationStatementV1,
} from "@tracepack/attestation";

import {
  attestationStatementBytes,
} from "@tracepack/attestation";

import {
  signAttestationWithSigstore,
} from "../src/sign-attestation";

const workflowRef =
  process.env.GITHUB_WORKFLOW_REF;

if (!workflowRef) {
  throw new Error(
    "GITHUB_WORKFLOW_REF is required. " +
      "Generate this fixture inside GitHub Actions.",
  );
}

const expectedIssuer =
  "https://token.actions.githubusercontent.com";

const expectedSubject =
  `https://github.com/${workflowRef}`;

const statement: AttestationStatementV1 = {
  schema_version:
    "tracepack-attestation/v1",

  attestation_id:
    "github-actions-attestation-fixture-v1",

  subject: {
    kind:
      "tracepack-pack",

    digest: {
      algorithm:
        "sha256",

      value:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },

    pack_version:
      "fixture-pack-v1",
  },

  statement: {
    type:
      "pack.approval",

    text:
      "TracePack Sigstore integration fixture",
  },

  signer: {
    party_id:
      "github-actions-fixture",

    role:
      "fixture-signer",

    expected_identity: {
      issuer:
        expectedIssuer,

      subject:
        expectedSubject,
    },
  },

  issued_at:
    "2026-08-26T00:00:00Z",
};

const signed =
  await signAttestationWithSigstore(
    statement,
  );

const payload =
  attestationStatementBytes(
    statement,
  );

const outputDirectory =
  resolve(
    process.cwd(),
    "fixture-output",
  );

mkdirSync(
  outputDirectory,
  {
    recursive: true,
  },
);

writeFileSync(
  resolve(
    outputDirectory,
    "attestation-statement.json",
  ),
  JSON.stringify(
    statement,
    null,
    2,
  ) + "\n",
);

writeFileSync(
  resolve(
    outputDirectory,
    "attestation-payload.bin",
  ),
  payload,
);

writeFileSync(
  resolve(
    outputDirectory,
    "attestation.sigstore.json",
  ),
  JSON.stringify(
    signed,
    null,
    2,
  ) + "\n",
);

console.log(
  JSON.stringify(
    {
      contentDigest:
        signed.signature
          .content_digest
          .value,

      bundleMediaType:
        signed.signature
          .bundle_media_type,

      payloadBytes:
        payload.byteLength,

      expectedIdentity: {
        issuer:
          expectedIssuer,

        subject:
          expectedSubject,
      },
    },
    null,
    2,
  ),
);
