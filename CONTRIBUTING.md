# Contributing to Tracepack

Thanks for considering a contribution. This document covers how to get set up, what's expected
of a change, and how the review process works.

## Getting set up

Requires [pnpm](https://pnpm.io) and Node.js.

```sh
git clone https://github.com/ace2016/tracepack.git
cd tracepack
pnpm install
pnpm run build:sdk
pnpm -r typecheck
pnpm -r test
```

`pnpm run build:sdk` builds `evidence-core`, `template-engine`, and `evidence-sdk` -- the three
packages published to npm as real standalone dependencies (see below). Every other package
resolves them through their compiled `dist/`, not raw source, so this has to run before a
typecheck or test against those packages will pass. `pnpm install`'s `postinstall` hook runs
this automatically on most installs, but not reliably on every pnpm code path (e.g. an
"already up to date" install can skip lifecycle scripts) -- run it explicitly if in doubt.

All three commands should pass cleanly on a fresh clone before you start. If they don't, that's
worth an issue on its own before anything else.

**Contributing a new template** (a different dispute or record type, e.g. tenancy deposit) is a
separate, narrower path that doesn't need most of the below -- see
[`templates/CONTRIBUTING.md`](templates/CONTRIBUTING.md).

## Making a change

1. **Open an issue first for anything non-trivial.** A bug fix with an obvious, small diff can
   just be a PR. Anything that changes behaviour, adds a dependency, or touches the
   `tracepack-evidence` interchange contract should be discussed first. The interchange
   contract in particular is **frozen as of v1** (see `packages/evidence-interchange/SPEC.md`);
   changes to what it requires need a new schema version, not an edit to what `1` means.
2. **Keep changes narrowly scoped.** A bug fix doesn't need surrounding cleanup. A new feature
   doesn't need speculative options for cases nobody asked for. If you're touching a package,
   extend its existing patterns rather than introducing a parallel way of doing the same thing.
   This repo has a few examples of exactly this discipline worth following: `saveProjectAndFiles`
   in `packages/storage` is additive next to the existing single-record functions, not a rewrite
   of the storage layer.
3. **Tests are not optional for behaviour changes.** If you fix a bug, add a test that would
   have caught it. If you add a capability, add a test that exercises it for real; prefer
   testing against real dependencies (see `packages/storage/tests/storage.test.ts`'s use of
   `fake-indexeddb`, or the clean-room producer's use of a real, independent RFC 8785 library)
   over mocking the thing you're actually trying to verify.
4. **Comments explain *why*, not *what*.** Code should be readable enough that a comment
   explaining what a line does is unnecessary. A comment earns its place when it captures a
   non-obvious constraint, a bug that was found and fixed, or a reason a simpler approach
   doesn't work. See almost any file in `packages/storage` or `packages/evidence-interchange`
   for the pattern this repo already follows.

## Before opening a PR

```sh
pnpm -r typecheck
pnpm -r test
```

For anything touching `apps/workspace` or `apps/extension`, also actually run it: start the
dev server and click through the flow your change affects. Passing tests verify correctness of
the code you tested; they don't verify the UI actually works. For extension changes, see
`apps/extension/e2e/CHROME_EDGE_CHECKLIST.md` for what needs manual verification on a real
browser.

## The `tracepack-evidence` interchange contract specifically

If your change touches `packages/evidence-interchange`, read `SPEC.md` in that package first.
It documents not just what the format is, but why each decision was made, including some that
look simpler than the alternative that was rejected. Changes here have a higher bar because
external producers (tools that aren't Tracepack) depend on this contract being stable. See
`examples/producers/consumer-rights-helper/` for what "an independent implementation of this
contract" actually looks like, and consider whether your change would still work from that
producer's point of view. It deliberately imports nothing from this repo's own code.

## License and the CLA

This repository carries two licenses; see [`LICENSING.md`](LICENSING.md) for which path is
under which one. Before a pull request touching an AGPLv3 covered path can be merged, you
need to sign the [Contributor License Agreement](CLA.md). It grants Tracepack the rights
needed to offer both the AGPLv3 and commercial license tracks described in
[`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md); it does not take your copyright away from
you. Sign it by adding a line to your pull request as described in `CLA.md`. Tracepack asks
for it on every contribution rather than only the ones that strictly need it, so you do not
have to work out which license applies before opening a pull request.

## Code of Conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Governance

See [`GOVERNANCE.md`](GOVERNANCE.md) for who maintains this project and how decisions get made.

## Questions

Open an issue if something in this document is unclear, or if you're not sure whether a change
is in scope. That's a legitimate question, not a bother.
