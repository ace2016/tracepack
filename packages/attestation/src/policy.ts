import type {
  AttestationPolicyResultV1,
  AttestationVerificationResultV1,
  MultiPartyAttestationPolicyV1,
  Sha256Digest,
} from "./types";

function sameDigest(
  left: Sha256Digest,
  right: Sha256Digest,
): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.value === right.value
  );
}

export function evaluateAttestationPolicy(
  policy: MultiPartyAttestationPolicyV1,
  verificationResults:
    AttestationVerificationResultV1[],
): AttestationPolicyResultV1 {
  if (policy.requirements.length === 0) {
    return {
      satisfied: false,
      requirements: [],
    };
  }


  const requirements =
    policy.requirements.map(
      (requirement) => {
        if (
          !Number.isInteger(
            requirement.minimum_signers,
          ) ||
          requirement.minimum_signers < 1
        ) {
          return {
            requirement_id:
              requirement.id,
            satisfied: false,
            required:
              requirement.minimum_signers,
            matched_parties: [],
          };
        }

        const parties = new Map<
          string,
          string
        >();

        for (
          const result of verificationResults
        ) {
          if (!result.valid) continue;

          const statement =
            result.attestation.statement;

          if (
            !sameDigest(
              statement.subject.digest,
              policy.subject.digest,
            )
          ) {
            continue;
          }

          if (
            statement.statement.type !==
            requirement.statement_type
          ) {
            continue;
          }

          if (
            requirement.role &&
            statement.signer.role !==
              requirement.role
          ) {
            continue;
          }

          if (
            requirement
              .require_identity_binding ===
              true &&
            result.identity_binding !==
              "matched"
          ) {
            continue;
          }

          const verifiedIdentityKey =
            [
              result.verified_identity.issuer,
              result.verified_identity.subject,
            ].join("\n");

          if (
            !parties.has(
              verifiedIdentityKey,
            )
          ) {
            parties.set(
              verifiedIdentityKey,
              statement.signer.party_id,
            );
          }
        }

        const matchedParties =
          Array.from(
            parties.values(),
          ).sort();

        return {
          requirement_id:
            requirement.id,
          satisfied:
            matchedParties.length >=
            requirement.minimum_signers,
          required:
            requirement.minimum_signers,
          matched_parties:
            matchedParties,
        };
      },
    );

  return {
    satisfied: requirements.every(
      (requirement) =>
        requirement.satisfied,
    ),
    requirements,
  };
}
