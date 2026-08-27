# Publishing Tracepack developer packages

Tracepack publishes eight public developer packages:

1. `@tracepack/evidence-core`
2. `@tracepack/template-engine`
3. `@tracepack/evidence-sdk`
4. `@tracepack/integration`
5. `@tracepack/cli`
6. `@tracepack/attestation`
7. `@tracepack/attestation-sigstore`
8. `@tracepack/pack-attestation`

`@tracepack/evidence-interchange` is deliberately not a fifth public package. It is the
Tracepack workspace's internal importer and depends on browser storage and document processing.
External producers use `@tracepack/evidence-sdk`, the public JSON Schema and the producer guide.

The public `ace2016/tracepack` repository is the only repository allowed to publish them. The
private development repository cannot create npm provenance, even when a package itself is
public.

## Trusted publishing configuration

Every public package uses an npm trusted GitHub Actions publisher with these exact values:

| Field | Value |
| --- | --- |
| GitHub owner | `ace2016` |
| Repository | `tracepack` |
| Workflow | `publish.yml` |
| Environment | `npm-production` |
| Allowed action | `npm publish` |

Trusted publishing uses a short lived GitHub identity instead of a reusable publishing secret.
The workflow must not set `NODE_AUTH_TOKEN`. Each package requires two factor authentication and
disallows bypass-2FA tokens. For public packages built in the public repository, npm creates
provenance automatically.
It requires npm 11.5.1 or newer, Node 22.14.0 or newer and a GitHub hosted runner. The release
workflow uses Node 24 and updates npm before publishing.

## Release routine

1. Update package versions intentionally.
   The `developer-v<version>` tag must match all eight package versions or the workflow stops
   before signing or publishing. Release tags currently accept only the stable
   `developer-vX.Y.Z` form. Prerelease tags are rejected rather than published under npm's
   default `latest` channel.
2. Run `pnpm run build:sdk`, `pnpm -r typecheck` and `pnpm -r test`.
3. Run `pnpm run release:check` and review all eight generated archives.
4. Merge the reviewed change into the public repository.
5. Run the publishing workflow and approve the `npm-production` environment.
6. Check the npm provenance badge, run `npm audit signatures` in a clean test project and verify
   the downloaded archives using [`VERIFYING_RELEASES.md`](VERIFYING_RELEASES.md).
7. Install the CLI and SDK in a clean project and run their documented examples.

Sigstore is used only for software release provenance. Evidence files, evidence hashes, pack
hashes and user information must never be submitted to its public transparency log.
