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

  for (
    let index = 0;
    index < policy.requirements.length;
    index += 1
  ) {
    if (!(index in policy.requirements)) {
      return {
        satisfied: false,
        requirements: [],
      };
    }
  }


  const requirements =
    policy.requirements.map(
      (requirement) => {
        const requirementId =
          requirement.id;

        const minimumSigners =
          requirement.minimum_signers;

        const role =
          requirement.role;

        const requireIdentityBinding =
          requirement.require_identity_binding;

        const statementType =
          requirement.statement_type;

        if (
          !Number.isInteger(
            minimumSigners,
          ) ||
          minimumSigners < 1
        ) {
          return {
            requirement_id:
              requirementId,
            satisfied: false,
            required:
              minimumSigners,
            matched_parties: [],
          };
        }

        if (
          role !== undefined &&
          role.length === 0
        ) {
          return {
            requirement_id:
              requirementId,
            satisfied: false,
            required:
              minimumSigners,
            matched_parties: [],
          };
        }

        if (
          requireIdentityBinding !==
            undefined &&
          typeof requireIdentityBinding !==
            "boolean"
        ) {
          return {
            requirement_id:
              requirementId,
            satisfied: false,
            required:
              minimumSigners,
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
            statementType
          ) {
            continue;
          }

          if (
            role !== undefined &&
            statement.signer.role !==
              role
          ) {
            continue;
          }

          if (
            requireIdentityBinding ===
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
            minimumSigners,
          required:
            minimumSigners,
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
