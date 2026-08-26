export type JsonPrimitive =
  | string
  | number
  | boolean
  | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | JsonObject;

export type JsonObject = {
  [key: string]: JsonValue;
};

export interface Sha256Digest {
  algorithm: "sha256";
  value: string;
}

export interface AttestationSubjectV1 {
  kind: "tracepack-pack";
  digest: Sha256Digest;
  pack_version?: string | number;
}

export interface ExpectedSignerIdentityV1 {
  issuer: string;
  subject: string;
}

export interface AttestationSignerV1 {
  party_id: string;
  display_name?: string;
  role?: string;
  organisation?: {
    id?: string;
    name?: string;
  };
  expected_identity?: ExpectedSignerIdentityV1;
}

export interface AttestationStatementV1 {
  schema_version: "tracepack-attestation/v1";
  attestation_id: string;
  subject: AttestationSubjectV1;
  statement: {
    type: string;
    text: string;
  };
  signer: AttestationSignerV1;
  issued_at: string;
  metadata?: JsonObject;
}

export interface SigstoreSignatureV1 {
  method: "sigstore";
  content_digest: Sha256Digest;
  bundle_media_type: string;
  bundle: JsonObject;
}

export interface SignedAttestationV1 {
  statement: AttestationStatementV1;
  signature: SigstoreSignatureV1;
}

export interface VerifiedSigstoreIdentityV1 {
  issuer: string;
  subject: string;
}

export type AttestationVerificationStageId =
  | "structure"
  | "canonicalization"
  | "content_digest"
  | "bundle"
  | "trusted_root"
  | "certificate"
  | "transparency_log"
  | "timestamp"
  | "signature"
  | "identity"
  | "policy";

export type AttestationVerificationStageStatus =
  | "pending"
  | "passed"
  | "failed"
  | "skipped";

export interface AttestationVerificationStageV1 {
  id: AttestationVerificationStageId;
  status: AttestationVerificationStageStatus;
  code?: string;
  message?: string;
}

export interface AttestationVerificationEvidenceV1 {
  bundle_media_type?: string;
  certificate_issuer?: string;
  certificate_subject?: string;
  certificate_not_before?: string;
  certificate_not_after?: string;
  transparency_log_verified?: boolean;
  transparency_log_index?: string;
  integrated_time?: string;
  trusted_timestamp_verified?: boolean;
  signing_time?: string;
}

export interface AttestationVerificationReportV1 {
  stages: AttestationVerificationStageV1[];
  evidence?: AttestationVerificationEvidenceV1;
}

export type IdentityBindingState =
  | "matched"
  | "not_declared";

export type AttestationVerificationFailureReason =
  | "invalid_structure"
  | "content_digest_mismatch"
  | "sigstore_verification_failed"
  | "identity_mismatch";

export type AttestationVerificationResultV1 =
  | {
      valid: true;
      attestation: SignedAttestationV1;
      verified_identity: VerifiedSigstoreIdentityV1;
      identity_binding: IdentityBindingState;
      report?: AttestationVerificationReportV1;
    }
  | {
      valid: false;
      reason: AttestationVerificationFailureReason;
      errors?: string[];
      report?: AttestationVerificationReportV1;
    };

export interface AttestationRequirementV1 {
  id: string;
  statement_type: string;
  role?: string;
  minimum_signers: number;
  require_identity_binding?: boolean;
}

export interface MultiPartyAttestationPolicyV1 {
  policy_version: "tracepack-attestation-policy/v1";
  subject: AttestationSubjectV1;
  requirements: AttestationRequirementV1[];
}

export interface AttestationRequirementResultV1 {
  requirement_id: string;
  satisfied: boolean;
  required: number;
  matched_parties: string[];
}

export interface AttestationPolicyResultV1 {
  satisfied: boolean;
  requirements: AttestationRequirementResultV1[];
}
