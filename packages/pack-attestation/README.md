# @tracepack/pack-attestation

Integration layer for binding finalized TracePack pack state to Attestation v1 subjects.

It provides:

- deterministic pack snapshots;
- pack-version binding;
- evidence-order and export-relevant metadata binding;
- SHA-256 verification of included evidence bytes;
- pack-snapshot attestation subject creation;
- pack-subject policy helpers.

Before an attestation subject is created, included evidence bytes are verified against their
recorded content hashes. Missing or mismatched included evidence is rejected.

Excluded evidence is not part of the finalized attested pack subject.

## Install

```sh
npm install @tracepack/pack-attestation
```

This package does not sign attestations itself. Use `@tracepack/attestation-sigstore` when
Sigstore signing or verification is required.

See [`../attestation/SPEC.md`](../attestation/SPEC.md) for the Attestation v1 trust model.
