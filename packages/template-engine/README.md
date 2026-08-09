# @tracepack/template-engine

Loads and validates a Tracepack `template.yaml` definition into a `TemplateSnapshot` -- the
structure that shapes a pack's categories, accepted evidence types, privacy rules, and
chronology/guidance behaviour. The same schema and the same validation apply whether a template
ships as a YAML file (`loadTemplate`) or is assembled at runtime by a user (`parseTemplateObject`) -- there is no separate, looser path for one or the other.

## Install

```
npm install @tracepack/template-engine
```

## Usage

```ts
import { loadTemplate } from "@tracepack/template-engine";

const template = loadTemplate(`
id: example
name: Example template
version: 1.0.0
jurisdiction: general
categories:
  - id: docs
    name: Documents
    requirement: required
    description: Any relevant documents.
    accepted_types: [pdf, image]
export_sections: [cover, evidence_index, evidence_documents]
`);

// template is a TemplateSnapshot (from @tracepack/evidence-core), ready to hand to
// evidence-core's createProject(...).
```

`loadTemplate` and `parseTemplateObject` both throw a Zod error on an invalid template -- catch it
to surface a template-authoring mistake as a clear message rather than letting it propagate.

### What's validated

- Every category needs an `id`, `name`, `requirement` (`required` | `recommended` | `optional`),
  `description`, and at least one entry in `accepted_types`.
- `min_items` (optional): how many items a category needs before it counts as satisfied. Omitted
  means "at least one."
- `privacy_rules` (optional): each entry's `pattern` is checked at load time -- a broken regular
  expression fails immediately, as a clear template-authoring error, not silently at scan time.
- `chronology_rules.max_gap_days` (optional): flags a gap between two pieces of dated evidence
  wider than this many days.
- `guidance` (optional): contextual help text keyed by category id.

See [`../../templates/`](../../templates/) in the Tracepack repository for real, working
`template.yaml` examples, and the CLI's `validate-template` command
(`@tracepack/cli`) for checking a template file from the command line without writing any code.

## License

MIT
