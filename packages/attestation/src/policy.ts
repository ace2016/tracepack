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
  const sourceRequirements =
    policy.requirements;

  const lengthDescriptor =
    Object.getOwnPropertyDescriptor(
      sourceRequirements,
      "length",
    );

  if (
    lengthDescriptor === undefined ||
    "get" in lengthDescriptor ||
    "set" in lengthDescriptor ||
    !Number.isSafeInteger(
      lengthDescriptor.value,
    ) ||
    lengthDescriptor.value < 1
  ) {
    return {
      satisfied: false,
      requirements: [],
    };
  }

  const requirementCount =
    lengthDescriptor.value;

  const requirementSnapshots: Array<{
    id: string;
    statement_type: string;
    role?: string;
    minimum_signers: number;
    require_identity_binding?: boolean;
  }> = [];

  for (
    let index = 0;
    index < requirementCount;
    index += 1
  ) {
    const descriptor =
      Object.getOwnPropertyDescriptor(
        sourceRequirements,
        String(index),
      );

    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      "get" in descriptor ||
      "set" in descriptor
    ) {
      return {
        satisfied: false,
        requirements: [],
      };
    }

    const requirement =
      descriptor.value;

    if (
      typeof requirement !== "object" ||
      requirement === null
    ) {
      return {
        satisfied: false,
        requirements: [],
      };
    }

    const requirementId =
      requirement.id;

    const statementType =
      requirement.statement_type;

    const role =
      requirement.role;

    const minimumSigners =
      requirement.minimum_signers;

    const requireIdentityBinding =
      requirement.require_identity_binding;

    requirementSnapshots.push({
      id: requirementId,
      statement_type:
        statementType,
      role,
      minimum_signers:
        minimumSigners,
      require_identity_binding:
        requireIdentityBinding,
    });
  }

  const requirements =
    requirementSnapshots.map(
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
          (
            typeof role !== "string" ||
            role.length === 0
          )
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
            requirementId,
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
