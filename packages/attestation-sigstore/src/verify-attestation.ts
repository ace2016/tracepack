import {
  createVerificationReport,
  setVerificationStage,
  verifySignedAttestation,
} from "@tracepack/attestation";

import type {
  AttestationVerificationResultV1,
} from "@tracepack/attestation";

import {
  SigstoreVerificationError,
  verifyWithSigstore,
} from "./verify";

import type {
  SigstoreIdentityPolicy,
} from "./types";

export async function verifyAttestationWithSigstore(
  input: unknown,
  policy: SigstoreIdentityPolicy = {},
): Promise<AttestationVerificationResultV1> {
  return verifySignedAttestation(
    input,
    async ({
      payload,
      bundle,
      bundleMediaType,
    }) => {
      const embeddedMediaType =
        typeof bundle.mediaType === "string"
          ? bundle.mediaType
          : undefined;

      if (
        embeddedMediaType !==
        bundleMediaType
      ) {
        const message =
          `Sigstore bundle media type mismatch: envelope declares "${bundleMediaType}" but bundle declares "${embeddedMediaType ?? "missing"}".`;

        const report =
          createVerificationReport();

        setVerificationStage(
          report,
          "bundle",
          "failed",
          {
            code:
              "SIGSTORE_BUNDLE_MEDIA_TYPE_MISMATCH",
            message,
          },
        );

        for (const stage of [
          "trusted_root",
          "certificate",
          "transparency_log",
          "timestamp",
          "signature",
          "identity",
          "policy",
        ] as const) {
          setVerificationStage(
            report,
            stage,
            "skipped",
            {
              message:
                "Skipped because bundle media type validation failed.",
            },
          );
        }

        throw new SigstoreVerificationError(
          message,
          report,
        );
      }

      const result =
        await verifyWithSigstore(
          payload,
          bundle,
          policy,
        );

      return result;
    },
  );
}
