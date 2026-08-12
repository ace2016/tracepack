# Publishing Tracepack developer packages

Tracepack publishes four public packages:

1. `@tracepack/evidence-core`
2. `@tracepack/template-engine`
3. `@tracepack/evidence-sdk`
4. `@tracepack/cli`

`@tracepack/evidence-interchange` is deliberately not a fifth public package. It is the
Tracepack workspace's internal importer and depends on browser storage and document processing.
External producers use `@tracepack/evidence-sdk`, the public JSON Schema and the producer guide.

The public `ace2016/tracepack` repository is the only repository allowed to publish them. The
private development repository cannot create npm provenance, even when a package itself is
public.

## Before the first release

1. Create or confirm the `@tracepack` scope on npm and make sure the maintainer account has two
   factor authentication enabled.
2. Review every package name, version, archive and licence. An npm version cannot be overwritten
   after publication.
3. Copy the reviewed release commit to the public `ace2016/tracepack` repository.
4. Create a short lived granular npm token that can publish only the `@tracepack` scope and
   can bypass two factor authentication for automation.
5. Add it to the public GitHub repository as the `NPM_TOKEN` Actions secret. Never put the token in
   a file, commit, issue or chat.
6. Add required reviewers to the `npm-production` GitHub environment. The workflow will wait for
   approval before publishing.
7. Create the release tag from the reviewed public commit. A tag such as `developer-v0.1.0`
   starts the `Publish verified developer packages` workflow.

Create the token only inside npm and save it directly as the public repository's `NPM_TOKEN`
secret. Never paste it into a terminal transcript, issue, pull request or chat. The workflow
builds and tests the repository, installs the archives in a clean project, creates and verifies a
Sigstore bundle for every archive, then publishes the same archives with npm provenance. It
attaches the archives, bundles and checksums to the matching GitHub release.

## Move to trusted publishing immediately

After the first version exists, configure a trusted GitHub Actions publisher for each package on
npmjs.com with these exact values:

| Field | Value |
| --- | --- |
| GitHub owner | `ace2016` |
| Repository | `tracepack` |
| Workflow | `publish.yml` |
| Environment | `npm-production` |
| Allowed action | `npm publish` |

Then run one verified release through the trusted publisher. When it succeeds:

1. Delete the `NPM_TOKEN` GitHub secret.
2. Revoke the granular token on npm.
3. Set each package to require two factor authentication and disallow traditional tokens.

Trusted publishing uses a short lived GitHub identity instead of a reusable publishing secret.
For public packages built in the public repository, npm creates provenance automatically.
It requires npm 11.5.1 or newer, Node 22.14.0 or newer and a GitHub hosted runner. The release
workflow uses Node 24 and updates npm before publishing.

## Release routine

1. Update package versions intentionally.
2. Run `pnpm run build:sdk`, `pnpm -r typecheck` and `pnpm -r test`.
3. Run `pnpm run release:check` and review all four generated archives.
4. Merge the reviewed change into the public repository.
5. Run the publishing workflow and approve the `npm-production` environment.
6. Check the npm provenance badge, run `npm audit signatures` in a clean test project and verify
   the downloaded archives using [`VERIFYING_RELEASES.md`](VERIFYING_RELEASES.md).
7. Install the CLI and SDK in a clean project and run their documented examples.

Sigstore is used only for software release provenance. Evidence files, evidence hashes, pack
hashes and user information must never be submitted to its public transparency log.
