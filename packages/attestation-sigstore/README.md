# @tracepack/attestation-sigstore

Sigstore signing and verification runtime for TracePack Attestation v1.

This package connects the portable `@tracepack/attestation` contract to Sigstore.

It provides:

- Sigstore signing for canonical TracePack attestation statements;
- verification of signed attestations and Sigstore bundles;
- verified signing identity extraction;
- certificate, transparency-log, timestamp and signature verification;
- integration with the portable Attestation v1 model.

A successfully verified attestation can authenticate its signing identity. It does not
authenticate a `tracepack-evidence` producer identity, prove that evidence is true, or turn an
integrity hash into proof of authorship.

## Install

```sh
npm install @tracepack/attestation @tracepack/attestation-sigstore
```

See [`../attestation/SPEC.md`](../attestation/SPEC.md) for the normative Attestation v1 trust
model.
