# TracePack Attestation v1

TracePack Attestation v1 defines a portable cryptographic attestation envelope for binding an independently signed statement to one exact immutable TracePack pack digest.

## Core rule

Every attestation identifies one subject pack by SHA-256 digest.

A signature applies to the RFC 8785 canonical JSON bytes of the complete attestation statement. The statement includes the pack digest, statement type, statement text, claimed signer, role and timestamp.

Changing any of those fields changes the signed content.

## Sigstore

The v1 signed envelope uses Sigstore.

The envelope stores:

- the SHA-256 digest of the canonical statement bytes;
- the Sigstore bundle media type;
- the Sigstore verification bundle.

A verifier must verify the bundle against the exact canonical statement bytes.

A stored `content_digest` is an integrity aid. It is not a substitute for Sigstore verification.

## Identity

`signer.party_id`, display name, role and organisation are claims inside the signed statement.

Where `expected_identity` is present, successful verification also requires the identity returned by the Sigstore verifier to match that declared identity.

A cryptographic signature proves control of the signing identity used for that signature and integrity of the signed statement. It does not by itself prove that the evidence is factually true, that every claim in the pack is correct, or that a signer has a particular legal authority.

## Multi-party signing

Multi-party signing is represented as multiple independent signed attestations that all bind to the same pack digest.

Each party receives its own attestation and signature. TracePack does not combine several people into one opaque signature.

A multi-party policy declares the required statement types, roles, minimum number of distinct parties and whether cryptographic identity binding is required.

## Reviews and attestations

A workflow review and a cryptographic attestation are related but distinct.

A review records a human or organisational decision in the application workflow.

An attestation cryptographically binds an identified signing party to a statement about one immutable pack version.

Hosted TracePack products may require a completed review before permitting the corresponding attestation.

## PDF encryption

PDF password protection is not part of this contract.

TracePack export may independently offer no PDF encryption, AES-128 or AES-256. Encryption protects access to the exported representation. Attestation protects the integrity and provenance of the signed pack statement.

Changing an export password must not rewrite the underlying attestation history.
