# @tracepack/attestation

Portable TracePack attestation primitives.

This package provides the portable TracePack Attestation v1 contract and verification primitives used by TracePack developer tooling.

It provides:

- a versioned Attestation v1 statement model;
- RFC 8785 canonicalisation;
- SHA-256 binding of signable statement bytes;
- a Sigstore signature envelope;
- signer identity binding;
- multi-party signing policy evaluation;
- structural validation and tests.

The package contains no TracePack Cloud, Supabase, account, billing or organisation-RBAC dependency.

See `SPEC.md` for the trust model and normative rules.
