import {
  readFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

import {
  verifyAttestationWithSigstore,
} from "../src/verify-attestation";

const fixturePath =
  resolve(
    process.cwd(),
    "fixture-output",
    "attestation.sigstore.json",
  );

const attestation =
  JSON.parse(
    readFileSync(
      fixturePath,
      "utf8",
    ),
  );

const expectedIdentity =
  attestation
    .statement
    ?.signer
    ?.expected_identity;

if (
  !expectedIdentity ||
  typeof expectedIdentity.issuer !==
    "string" ||
  typeof expectedIdentity.subject !==
    "string"
) {
  throw new Error(
    "Fixture is missing its expected signer identity.",
  );
}

const result =
  await verifyAttestationWithSigstore(
    attestation,
    {
      certificateIssuer:
        expectedIdentity.issuer,

      certificateIdentityURI:
        expectedIdentity.subject,
    },
  );

if (!result.valid) {
  throw new Error(
    JSON.stringify(
      {
        reason:
          result.reason,
        errors:
          result.errors,
        report:
          result.report,
      },
      null,
      2,
    ),
  );
}

console.log(
  "TRACEPACK_ATTESTATION_VERIFIED",
);

console.log(
  JSON.stringify(
    {
      issuer:
        result.verified_identity
          .issuer,

      subject:
        result.verified_identity
          .subject,

      identityBinding:
        result.identity_binding,

      statementType:
        result.attestation
          .statement
          .statement
          .type,

      subjectDigest:
        result.attestation
          .statement
          .subject
          .digest
          .value,

      report:
        result.report,
    },
    null,
    2,
  ),
);
