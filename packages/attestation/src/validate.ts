import { z } from "zod";
import type {
  AttestationStatementV1,
  JsonValue,
  MultiPartyAttestationPolicyV1,
  SignedAttestationV1,
} from "./types.js";

const jsonValueSchema: z.ZodType<JsonValue> =
  z.lazy(() =>
    z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema),
    ]),
  );

const sha256DigestSchema = z
  .object({
    algorithm: z.literal("sha256"),
    value: z
      .string()
      .regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const subjectSchema = z
  .object({
    kind: z.literal("tracepack-pack"),
    digest: sha256DigestSchema,
    pack_version: z
      .union([z.string(), z.number().int()])
      .optional(),
  })
  .strict();

const expectedIdentitySchema = z
  .object({
    issuer: z.string().min(1).max(2048),
    subject: z.string().min(1).max(4096),
  })
  .strict();

export const attestationStatementSchema = z
  .object({
    schema_version: z.literal(
      "tracepack-attestation/v1",
    ),
    attestation_id: z
      .string()
      .min(1)
      .max(256),
    subject: subjectSchema,
    statement: z
      .object({
        type: z
          .string()
          .min(1)
          .max(128)
          .regex(
            /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
          ),
        text: z
          .string()
          .min(1)
          .max(8192),
      })
      .strict(),
    signer: z
      .object({
        party_id: z
          .string()
          .min(1)
          .max(512),
        display_name: z
          .string()
          .min(1)
          .max(512)
          .optional(),
        role: z
          .string()
          .min(1)
          .max(256)
          .optional(),
        organisation: z
          .object({
            id: z
              .string()
              .min(1)
              .max(512)
              .optional(),
            name: z
              .string()
              .min(1)
              .max(512)
              .optional(),
          })
          .strict()
          .optional(),
        expected_identity:
          expectedIdentitySchema.optional(),
      })
      .strict(),
    issued_at: z
      .string()
      .datetime({ offset: true }),
    metadata: z
      .record(z.string(), jsonValueSchema)
      .optional(),
  })
  .strict();

export const signedAttestationSchema = z
  .object({
    statement: attestationStatementSchema,
    signature: z
      .object({
        method: z.literal("sigstore"),
        content_digest: sha256DigestSchema,
        bundle_media_type: z
          .string()
          .min(1)
          .max(512),
        bundle: z.record(
          z.string(),
          jsonValueSchema,
        ),
      })
      .strict(),
  })
  .strict();

export const multiPartyPolicySchema = z
  .object({
    policy_version: z.literal(
      "tracepack-attestation-policy/v1",
    ),
    subject: subjectSchema,
    requirements: z
      .array(
        z
          .object({
            id: z
              .string()
              .min(1)
              .max(256),
            statement_type: z
              .string()
              .min(1)
              .max(128),
            role: z
              .string()
              .min(1)
              .max(256)
              .optional(),
            minimum_signers: z
              .number()
              .int()
              .min(1),
            require_identity_binding:
              z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function issueMessages(
  error: z.ZodError,
): string[] {
  return error.issues.map((issue) => {
    const path =
      issue.path.length > 0
        ? `${issue.path.join(".")}: `
        : "";

    return `${path}${issue.message}`;
  });
}

export function parseAttestationStatement(
  value: unknown,
): AttestationStatementV1 {
  return attestationStatementSchema.parse(
    value,
  ) as AttestationStatementV1;
}

export function parseSignedAttestation(
  value: unknown,
): SignedAttestationV1 {
  return signedAttestationSchema.parse(
    value,
  ) as SignedAttestationV1;
}

export function safeParseSignedAttestation(
  value: unknown,
):
  | {
      success: true;
      data: SignedAttestationV1;
    }
  | {
      success: false;
      errors: string[];
    } {
  const result =
    signedAttestationSchema.safeParse(value);

  if (!result.success) {
    return {
      success: false,
      errors: issueMessages(result.error),
    };
  }

  return {
    success: true,
    data: result.data as SignedAttestationV1,
  };
}

export function parseMultiPartyPolicy(
  value: unknown,
): MultiPartyAttestationPolicyV1 {
  return multiPartyPolicySchema.parse(
    value,
  ) as MultiPartyAttestationPolicyV1;
}
