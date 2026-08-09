# Tracepack Individual Contributor License Agreement

This agreement is between you (the contributor) and **Spendmita Ltd** (registered in England
and Wales, company number 17200525, ICO registration ZC140295), the company behind Tracepack
("Tracepack"). It exists because Tracepack
dual licenses part of this codebase, AGPLv3 for the public and a separate commercial license
for anyone who wants different terms (see [`LICENSING.md`](LICENSING.md) and
[`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md)). That only works if Tracepack actually holds
the rights needed to offer both, including for code someone else wrote and contributed. This
agreement grants those rights. It does not take your copyright away from you.

Signing this is required before a pull request touching a path under AGPLv3 (see the table
in `LICENSING.md`) can be merged. Contributions to the Apache-2.0 packages
(`evidence-core`, `evidence-sdk`, `template-engine`, `cli`, `examples/`) do not need it, since
those packages carry no dual license to protect; a normal Apache-2.0 contribution already
covers them. Tracepack asks for it on every contribution anyway, so contributors do not have
to reason about which directory needs which agreement before opening a pull request.

## 1. You keep your copyright

You are not assigning your copyright to Tracepack. You keep it. This agreement is a license
grant, not a transfer of ownership.

## 2. What you grant

For any contribution you submit to this repository, you grant Tracepack a permanent,
worldwide, royalty free, irrevocable license to:

- use, reproduce, modify, and distribute your contribution as part of the project, under
  AGPLv3, the license this repository already uses for the code you are contributing to; and
- separately license your contribution, alone or as part of the project, under different
  terms, including a commercial license, to third parties who want terms other than AGPLv3.

The second point is the one that makes dual licensing work. Without it, Tracepack could
distribute your contribution under AGPLv3 but could not include it in a commercial license
sold to someone else, since that would require rights only you would hold.

You also grant Tracepack a patent license covering any patent claims you can license that
your contribution would otherwise infringe, so that using your contribution as part of the
project cannot later become a patent problem for Tracepack or anyone using the project.

## 3. What you are promising

You are confirming that:

- the contribution is your own original work, or you have the right to submit it under this
  agreement (for example, your employer has agreed you can);
- you are not aware of it infringing anyone else's copyright, patent, or other rights; and
- if any of that changes, or turns out to be wrong, you will tell Tracepack.

You are not promising the contribution is bug free or fit for any particular purpose. This
agreement does not create any warranty beyond the statements above.

## 4. How to sign

Add a line to your first pull request, or to `CONTRIBUTORS.md` if this repository keeps one,
stating your name (or the name you want attributed) and the sentence: "I have read and agree
to the Tracepack Individual Contributor License Agreement in CLA.md." A maintainer will not
merge a pull request touching code under AGPLv3 without this on record.
