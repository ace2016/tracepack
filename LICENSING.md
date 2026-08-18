# Licensing

This repository is not under one single license. It carries two, split by what each part of
the code is for. This document is the map. If a package's own `LICENSE` file or `package.json`
ever seems to disagree with this table, this table wins; open an issue and it will get fixed.

## The split

**Apache License 2.0** covers the portable format and SDK layer, the code meant to be freely
implemented by anyone, including a competitor, with no obligation back to this project:

- `packages/evidence-core`
- `packages/evidence-sdk`
- `packages/template-engine`
- `packages/cli`
- `examples/`

Each of those directories carries its own `LICENSE` file with the full Apache-2.0 text, and
each published package's `package.json` says `"license": "Apache-2.0"`. This choice is not
incidental. The whole point of `tracepack-evidence` as an interchange format is that an
outside developer can build against it without asking permission or worrying about legal
terms. See `packages/evidence-interchange/PRODUCER_GUIDE.md` and
`examples/producers/consumer-rights-helper/` for what that promise is meant to enable.

**GNU Affero General Public License v3.0 (AGPLv3)** covers everything else: the actual
product. That means `apps/workspace`, `apps/extension`, `apps/developer`,
`packages/evidence-interchange`, `packages/document-engine`, `packages/export-engine`,
`packages/storage`, `templates/`, and `integrations/`. The root `LICENSE` file holds this text
and is the default for the repository; anything not listed above under Apache-2.0 is AGPLv3.

`integrations/` holds real, installable connectors to third-party platforms, as opposed to
`examples/`, which are reference implementations of the interchange format itself. Some of
these platforms carry their own licensing requirements that flow into the connector; see the
connector's own directory for specifics (`integrations/freescout/README.md`, for example, notes
that FreeScout's own AGPLv3 licence is why that connector is AGPLv3 rather than something more
permissive).

## What AGPLv3 actually means here

AGPLv3 is a real open source license, approved by the OSI. Anyone can read this code, run it,
modify it, and run their own copy of it, for free, forever. Nobody needs Tracepack's
permission for any of that.

The one thing AGPLv3 adds on top of a plain open source license: if you modify this code and
let other people use your modified version over a network, including running it as a hosted
service, you have to make your modified source available to those users. That is the whole
reason this license was picked over something more permissive. It does not stop anyone from
building a paid, hosted competitor on top of Tracepack. It makes them share what they changed
if they do.

## Why a commercial license exists

Not everyone wants that obligation, and that is exactly what a commercial license from
Tracepack is for. If you want to embed this product code in your own closed, hosted product,
white label it, resell it, or build a "Tracepack Cloud" style offering without the AGPLv3
duty to publish your modifications, you need a separate agreement with Tracepack instead of
relying on AGPLv3. See [`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md) for what that covers
and how to ask for one.

This is a standard dual license setup. Running your own copy and studying the code stays free
under AGPLv3. Building a closed commercial product on the parts of this repository under
AGPLv3 requires either complying with AGPLv3's duty to share source, or buying a commercial
license instead.

## Contributing to the AGPLv3 parts of this repository

Any contribution touching a path under AGPLv3 in this repository requires signing the
CLA first; see [`CLA.md`](CLA.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). Without it,
Tracepack cannot legally offer a commercial license that includes your change, since dual
licensing only works if the project actually holds the rights needed to relicense every line.

## Quick reference

| Path | License |
|---|---|
| `packages/evidence-core` | Apache-2.0 |
| `packages/evidence-sdk` | Apache-2.0 |
| `packages/template-engine` | Apache-2.0 |
| `packages/cli` | Apache-2.0 |
| `examples/` | Apache-2.0 |
| `apps/workspace` | AGPLv3 |
| `apps/extension` | AGPLv3 |
| `apps/developer` | AGPLv3 |
| `packages/evidence-interchange` | AGPLv3 |
| `packages/document-engine` | AGPLv3 |
| `packages/export-engine` | AGPLv3 |
| `packages/storage` | AGPLv3 |
| `templates/` | AGPLv3 |
| `integrations/` | AGPLv3 |
| everything else | AGPLv3 (the repository default) |
