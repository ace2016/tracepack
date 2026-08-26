import type {
  AttestationVerificationReportV1,
  JsonObject,
  VerifiedSigstoreIdentityV1,
} from "@tracepack/attestation";

export interface SigstoreIdentityPolicy {
  certificateIssuer?: string;
  certificateIdentityURI?: string;
}

export interface SigstoreSigningOptions {
  tsaServerURL?: string;
  tlogUpload?: boolean;
  identityToken?: string;
}

export interface SigstoreSigningResult {
  bundleMediaType: string;
  bundle: JsonObject;
}

export interface SigstoreRuntimeVerificationResult {
  identity: VerifiedSigstoreIdentityV1;
  report: AttestationVerificationReportV1;
}
