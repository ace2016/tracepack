# @tracepack/cli

Command-line validation for Tracepack `template.yaml` files, `tracepack-evidence` v1 payloads,
and exported `manifest.json` diffing -- outside the browser, so it runs in your own CI. Under
the hood this is the exact same schema and validation code Tracepack's own apps use
([`@tracepack/template-engine`](../template-engine/README.md),
[`@tracepack/evidence-sdk`](../evidence-sdk/README.md),
[`@tracepack/evidence-core`](../evidence-core/README.md)), bundled into one dependency-free
executable.

## Install

```
npm install -g @tracepack/cli
# or, without installing:
npx @tracepack/cli validate-template my-template.yaml
```

## Usage

```
tracepack validate-template <file.yaml>              Validate a template.yaml against the real schema
tracepack validate-evidence <file.json>               Validate a tracepack-evidence v1 payload
tracepack diff-manifest <before.json> <after.json>    Diff two exported manifest.json files
tracepack --help                                      Show usage
```

Exit code is `0` on a valid file, `1` on a validation failure, `2` if the file can't be read at
all (missing, unreadable). This makes it safe to drop directly into a CI step:

```yaml
# a GitHub Actions step, for example
- run: npx @tracepack/cli validate-template templates/my-template/template.yaml
```

### Validating a template

```
$ tracepack validate-template templates/tenancy-deposit/template.yaml
Valid template "Tenancy deposit dispute" (tenancy-deposit) -- 6 categories.
```

A broken template -- a missing required field, an empty `categories` array, an unparseable
`privacy_rules` regex pattern -- fails with the same error a template author would see if they
tried to load it in the real app, at the same point (template load, not scan time):

```
$ tracepack validate-template broken-template.yaml
Invalid template:
  [categories] Too small: expected array to have >=1 items
```

### Validating an evidence payload

```
$ tracepack validate-evidence payload.json
Valid tracepack-evidence v1 payload from "Example Tool" -- 2 attachments, 1 observation.
(This checks shape and required fields only -- it does not verify attachment/payload hashes, which requires the real import step.)
```

This is **structural and semantic validation only** -- the same scope as
`validateEvidencePayload` in `@tracepack/evidence-sdk`. It does not decode attachment bytes or
verify `integrity.payload_hash`/`attachments[].content_hash` actually match the content; that
requires the real import step (see
[`../evidence-interchange/PRODUCER_GUIDE.md`](../evidence-interchange/PRODUCER_GUIDE.md) §3 for
how those hashes are computed and what verifying them catches).

### Diffing two exported manifests

```
$ tracepack diff-manifest old-manifest.json new-manifest.json
Added (1):
  + e2 ("Follow-up email")
Metadata changed (1):
  ~ e1 ("Receipt (verified)"): title
0 item(s) unchanged.
```

Compares two `manifest.json` files -- downloaded from the workspace app, or extracted from a
`.tracepack` bundle -- by evidence item id and `contentHash`. Useful for showing exactly what
changed in a pack between two points in time (a new item added, a title corrected after
re-review) without re-reading the whole thing by eye.

Exit code is `0` for additions, removals, and ordinary metadata edits -- those are normal,
expected states, and are still reported in full, never hidden. Exit code is `1` only when an
item's `contentHash` changed under the same id, reported as an `ANOMALY`: Tracepack's own export
guarantee is that an evidence item's original bytes are never mutated (see
[`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)), so that specific case means either a
different file was substituted under the same id, or something producing the manifest is not
honouring that guarantee -- worth failing a CI check on, not just noting.

The underlying pure function, `diffManifests`, is exported from
[`@tracepack/evidence-core`](../evidence-core/README.md) if you want to diff manifests from
your own code instead of the command line.

## License

MIT
