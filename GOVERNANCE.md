# Governance

This document describes how decisions get made in Tracepack today, so that is stated plainly
rather than left to be guessed at from PR history. It describes the project as it actually is,
not an aspirational structure for a team that does not exist yet.

## Maintainer

Tracepack currently has one maintainer and current contributor:
[@ace2016](https://github.com/ace2016). No other person or automated system is presented as a
maintainer, reviewer, or decision-maker. If that ever changes, this document will be updated in
the same change that adds the new maintainer, not after the fact.

The maintainer:

- Reviews and merges (or declines) every pull request.
- Triages and responds to issues.
- Handles security reports (see [`SECURITY.md`](SECURITY.md)) and conduct reports (see
  [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)).
- Decides what ships in a release and when.
- Has final say on any design or scope question that reaches a disagreement.

## How decisions get made

Most day-to-day decisions happen in the open, in issues and pull requests, and follow
[`CONTRIBUTING.md`](CONTRIBUTING.md)'s existing rule: a small, obviously-scoped fix can just be
a pull request; anything that changes behaviour, adds a dependency, or touches the
`tracepack-evidence` interchange contract gets discussed in an issue first. There is no voting
process and no formal RFC process, because there is one maintainer to reach agreement with, not
a group to build consensus across. That is a description of the project's current size, not a
statement that a single person's judgement should go unquestioned -- disagreement in an issue or
PR review is exactly the right way to raise a concern, and the maintainer is expected to explain
a decision when asked, not simply assert it.

### Higher bar for the interchange contract

The `tracepack-evidence` v1 interchange contract
([`packages/evidence-interchange/SPEC.md`](packages/evidence-interchange/SPEC.md)) is **frozen
as of v1**: external producers depend on it staying stable, so changing what `schema_version: 1`
requires is not a decision the maintainer makes casually or alone in a PR description. A
breaking change needs a new `schema_version`, a design document explaining why the old version
cannot simply be extended, and time for anyone who has built against v1 to weigh in before it
ships. See `SPEC.md` itself for the reasoning already on record.

## Releases

The maintainer decides when to cut a release and what goes into it. There is no fixed release
calendar. Given the project has one maintainer, "released" currently means "the maintainer has
run the checks in [`README.md`](README.md)'s development section and the manual checklist in
[`apps/extension/e2e/CHROME_EDGE_CHECKLIST.md`](apps/extension/e2e/CHROME_EDGE_CHECKLIST.md), and
is satisfied the result is safe to use" -- not a vote or a sign-off from anyone else, because
there is no one else yet.

## Becoming a maintainer

There is no formal application process today, because there has never been a need for one. In
practice, a path to maintainer status would look like: a track record of accepted, well-scoped
contributions over time, engagement with review discussion (not just code), and demonstrated
judgement about what belongs in this project and what doesn't. Whether and when to extend
maintainer access to someone else is, for now, entirely the current maintainer's call. This
section will be replaced with a real process, not just a description of one, if and when a
second maintainer actually joins.

## If the maintainer becomes unavailable

**The trigger:** the maintainer has made no commits, releases, or responses to a security report
or a critical issue (data loss, a privacy/redaction bug, a broken build) for 90 consecutive days,
with no advance notice posted to the repository.

**What happens, concretely, using mechanisms that already exist today rather than a
pre-arranged handoff to a named person who doesn't exist yet:**

1. **The source code:** Tracepack carries two open source licenses, AGPLv3 for the product
   and Apache-2.0 for the format and SDK layer (see [`LICENSING.md`](LICENSING.md)), and both
   already guarantee the project cannot be taken away from its users. Once the trigger above
   is met, anyone may fork the repository and continue it, no permission needed, nothing to
   wait for; that guarantee holds under either license. A commercial license sold before the
   trigger is a separate contract between Tracepack and its buyer and is not affected by this
   section either way. If more than one fork emerges, the community recognised continuation is
   whichever fork the open issues and pull requests actually migrate to; this document does
   not, and cannot, pre-select a winner.
2. **The published npm packages** (`@tracepack/evidence-core`, `@tracepack/evidence-sdk`,
   `@tracepack/template-engine`, `@tracepack/cli`): npm has a real, existing process for exactly
   this situation -- an unresponsive maintainer blocking a package's continuation -- documented at
   [npm's package dispute policy](https://docs.npmjs.com/policies/disputes). Once the 90-day
   trigger is met, the maintainer of a continuation fork may use that process to request the
   package names be transferred, citing this document as evidence of the abandonment policy the
   original maintainer committed to in advance.
3. **The `tracepack.org` domain and its hosted infrastructure** (`app.`, `dev.`, and
   `docs.tracepack.org`): both now exist, registered and operated outside this repository under
   the project's current maintainer. No registrar/DNS handoff mechanism for the abandonment
   scenario has been defined yet -- this section still needs to be extended with the real
   transfer process before the 90-day trigger could ever matter in practice, not left silent the
   way the rest of this section used to be.

**What this deliberately does not do:** name a specific backup individual. Naming one without
that person's actual, current agreement to take on the role would be a placeholder dressed up as
a plan -- exactly the kind of TODO this project's own release checklist already rejects (see
`CODE_OF_CONDUCT.md`/`SECURITY.md`'s history of removing placeholder contact fields before they
shipped). If a second maintainer joins under the "Becoming a maintainer" section above, this
section gets rewritten to name them directly, the same way that section says it will.

## Conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for expected behaviour and how to report a
violation.

## Security

See [`SECURITY.md`](SECURITY.md) for the trust model and how to report a vulnerability.
