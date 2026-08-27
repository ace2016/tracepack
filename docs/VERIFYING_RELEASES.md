# Verifying Tracepack developer releases

Tracepack publishes two complementary forms of software provenance.

1. npm provenance links each published npm package to the public GitHub source and release
   workflow.
2. A Sigstore bundle signs each downloadable `.tgz` archive using the short lived GitHub Actions
   identity for the public repository's `publish.yml` workflow.

These checks prove where a software archive was built. They do not prove that an evidence
payload came from that software, that a producer name is genuine or that an observation is true.

## Verify npm provenance

Install with a current npm client, then verify registry signatures and attestations:

```sh
npm audit signatures
```

The package page on npmjs.com also shows its provenance statement and linked source commit.

## Verify a downloaded archive

Download an archive and its matching `.sigstore.json` file from the same GitHub release. Check
the release checksum first:

```sh
sha256sum --ignore-missing --check SHA256SUMS
```

Then verify the Sigstore bundle. Replace the tag and archive name with the release you downloaded:

```sh
cosign verify-blob \
  --bundle tracepack-evidence-sdk-0.2.1.tgz.sigstore.json \
  --certificate-identity "https://github.com/ace2016/tracepack/.github/workflows/publish.yml@refs/tags/developer-v0.2.1" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  tracepack-evidence-sdk-0.2.1.tgz
```

Verification must pin the complete repository, workflow and tag identity. A partial repository
name or loose substring is not sufficient.

## Privacy boundary

Only public software archives are submitted to Sigstore's public transparency infrastructure.
Tracepack never sends evidence files, support conversations, attachments, evidence hashes,
payload hashes, pack hashes, project titles or user information through this release process.
