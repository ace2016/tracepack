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
  const requirements =
    policy.requirements.map(
      (requirement) => {
        const parties = new Set<string>();

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

          parties.add(
            statement.signer.party_id,
          );
        }

        const matchedParties =
          Array.from(parties).sort();

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
