# Contributing a template

A Tracepack template shapes what a pack asks for: its categories, which evidence types each
accepts, and (optionally) what PII patterns, continuity checks, and contextual help apply while
that template is active. `consumer-complaint`, `provenance-trace`, and `general` in this
directory are not special-cased in the app's code in any way a new template couldn't also use -- see [`../packages/template-engine/README.md`](../packages/template-engine/README.md) for the
full schema, and the code comments in `packages/template-engine/src/index.ts` and
`packages/evidence-core/src/index.ts` for why it's shaped the way it is.

## 1. Is a new template the right thing here?

If what you need is a different set of categories or accepted evidence types for an existing
kind of dispute or record, a new template is likely right. If what you need is genuinely new
*behaviour* (a new kind of validation rule, a new evidence source type Tracepack can't import at
all yet), that's a code change, not a template -- open an issue first per the root
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

## 2. Write `templates/<your-id>/template.yaml`

Copy the shape of an existing template -- `templates/general/template.yaml` is the simplest
starting point (no `privacy_rules`, no `chronology_rules`, no `min_items`; every category
optional). Required top level fields: `id`, `name`, `version`, `jurisdiction`, `categories`
(at least one), `export_sections` (at least one). See
[`../packages/template-engine/README.md`](../packages/template-engine/README.md) for every
field, including the optional `privacy_rules`, `chronology_rules`, `guidance`, and `min_items`
mechanisms.

A worked example -- a tenancy deposit dispute template, the kind mentioned as a real future
candidate (multi-party: landlord and tenant both contributing evidence to the same pack):

```yaml
id: tenancy-deposit
name: Tenancy deposit dispute
version: 0.1.0
jurisdiction: UK
categories:
  - id: tenancy_agreement
    name: Tenancy agreement
    requirement: required
    description: The signed tenancy agreement showing the deposit amount and terms.
    accepted_types: [pdf, image]
  - id: check_in_report
    name: Check-in inventory and condition report
    requirement: required
    description: The property's condition at the start of the tenancy.
    accepted_types: [pdf, image]
  - id: check_out_report
    name: Check-out inventory and condition report
    requirement: required
    description: The property's condition at the end of the tenancy.
    accepted_types: [pdf, image]
  - id: correspondence
    name: Correspondence about the deposit
    requirement: recommended
    description: Messages or emails about the deposit deduction.
    accepted_types: [pdf, image, webpage, note]
  - id: repair_and_cleaning_costs
    name: Repair or cleaning cost evidence
    requirement: recommended
    description: Receipts or quotes the landlord is relying on for a deduction.
    accepted_types: [pdf, image]
export_sections: [cover, evidence_checklist, timeline, evidence_index, evidence_documents, source_manifest]
```

## 3. Validate it

```sh
npx @tracepack/cli validate-template templates/your-id/template.yaml
```

(Or, working from a clone of this repo without a published CLI release yet:
`pnpm --filter @tracepack/cli build && node packages/cli/dist/cli.js validate-template templates/your-id/template.yaml`.)

A broken template -- a missing required field, an unparseable `privacy_rules` regex -- fails here
with the same error a template author would get inside the real app, at the same point (template
load, not scan time). Fix it and re-run until it passes.

## 4. Ship it

`apps/workspace/src/template.ts` imports each shipped template's YAML file directly (via Vite's
`?raw` import -- the actual file on disk, not a copy) and lists it in one array. Add your
template there:

```diff
 import consumerComplaintYaml from "../../../templates/consumer-complaint/template.yaml?raw";
 import provenanceTraceYaml from "../../../templates/provenance-trace/template.yaml?raw";
 import generalYaml from "../../../templates/general/template.yaml?raw";
+import tenancyDepositYaml from "../../../templates/tenancy-deposit/template.yaml?raw";

 export const templates = [
   loadTemplate(consumerComplaintYaml),
   loadTemplate(provenanceTraceYaml),
   loadTemplate(generalYaml),
+  loadTemplate(tenancyDepositYaml),
 ];
```

That's the entire app-side change -- two lines, no YAML retyped, and it's deliberately not fully
automatic (e.g. glob-importing every folder under `templates/`): which templates ship, and in
what order (the first entry is the default a first-time user sees), is a real product decision,
not just file discovery. Everything else -- the picker, the "create your own" builder, PII
scanning, chronology gaps, guidance text -- already works from the schema alone; nothing about
those is hardcoded to the three templates that ship today.

## 5. Multi-party templates (landlord/tenant, buyer/seller)

Nothing here yet handles one pack being jointly built or signed by two parties -- every category
in today's schema is filled by whoever owns the pack. A tenancy-deposit template today is still
useful as a single party's own evidence record (either the landlord's or the tenant's), just not
as a shared, dual-signed one. Real multi-party support (both sides contributing to and attesting
the same pack) is tracked separately as a bigger, not-yet-built feature -- a template alone can't
add it.
