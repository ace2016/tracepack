import { parse } from "yaml";
import { z } from "zod";
import type { TemplateSnapshot } from "@tracepack/evidence-core";

const sourceType = z.enum(["pdf", "image", "note", "webpage"]);

// A pattern a template author never gets to see fail at scan time -- it's checked here, at
// load time, so a broken privacy_rules entry is a clear template-authoring error immediately,
// not a silently-skipped rule discovered only by noticing a PII pattern nobody flagged.
//
// Validated as pattern + flags TOGETHER, not the pattern alone: a pattern that compiles fine
// on its own can still throw once its own declared flags are added (an invalid flag letter, or
// a duplicated one like "gg"). document-engine's compileTemplateRules constructs the RegExp
// with exactly this pattern/flags pair (see its own comment, which used to claim this file
// already guaranteed that combination was valid -- it didn't, only the bare pattern was
// checked) and silently drops any rule that throws there, as defense in depth against a
// template that somehow got past this validation. That "silently drops" behaviour is the
// right fallback for an unexpected failure, but it must never be the ONLY thing standing
// between a broken template and PII detection that was promised but never actually runs.
const privacyRuleSchema = z.object({
  kind: z.string().min(1),
  label: z.string().min(1),
  pattern: z.string().min(1),
  flags: z.string().optional(),
}).refine((rule) => {
  try { new RegExp(rule.pattern, rule.flags); return true; } catch { return false; }
}, { message: "pattern and flags together must form a valid regular expression" });

const templateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  jurisdiction: z.string().min(1),
  categories: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    requirement: z.enum(["required", "recommended", "optional"]),
    description: z.string(),
    accepted_types: z.array(sourceType).min(1),
    // Optional: how many items this category needs before it counts as satisfied. Omitted
    // (or 1) keeps today's ">0 items" behaviour -- see getCategoryProgress in evidence-core.
    min_items: z.number().int().positive().optional(),
  })).min(1),
  export_sections: z.array(z.string()).min(1),
  // Optional so a template that has nothing complaint-specific to say about intake copy
  // (i.e. every template until now) doesn't need this section at all.
  intake: z.object({
    summary_label: z.string().min(1).optional(),
    summary_placeholder: z.string().min(1).optional(),
    resolution_label: z.string().min(1).optional(),
    resolution_placeholder: z.string().min(1).optional(),
  }).optional(),
  // Merged with document-engine's small universal built-in set (email, phone, payment card)
  // only while this template is active -- see packages/document-engine's compileTemplateRules.
  privacy_rules: z.array(privacyRuleSchema).optional(),
  // A gap wider than max_gap_days between two pieces of dated evidence gets flagged in the
  // timeline. Omitted means no continuity requirement -- most templates don't have one.
  chronology_rules: z.object({
    max_gap_days: z.number().int().positive(),
  }).optional(),
  // Contextual help shown next to a specific category, authored per template rather than
  // hardcoded per category id in the UI.
  guidance: z.array(z.object({
    category_id: z.string().min(1),
    text: z.string().min(1),
  })).optional(),
});

// Shared by loadTemplate (file-authored YAML) and parseTemplateObject (a template built at
// runtime, e.g. by a user in the "create your own" flow) so a hand-built template is validated
// exactly as strictly as one shipped in this repo -- there is no separate, looser path for
// user-defined structure.
function fromParsed(value: z.infer<typeof templateSchema>): TemplateSnapshot {
  return {
    id: value.id,
    name: value.name,
    version: value.version,
    jurisdiction: value.jurisdiction,
    categories: value.categories.map(({ accepted_types, min_items, ...category }) => ({
      ...category,
      acceptedTypes: accepted_types,
      minItems: min_items,
    })),
    exportSections: value.export_sections,
    summaryLabel: value.intake?.summary_label,
    summaryPlaceholder: value.intake?.summary_placeholder,
    resolutionLabel: value.intake?.resolution_label,
    resolutionPlaceholder: value.intake?.resolution_placeholder,
    privacyRules: value.privacy_rules,
    chronologyRules: value.chronology_rules ? { maxGapDays: value.chronology_rules.max_gap_days } : undefined,
    guidance: value.guidance?.map((entry) => ({ categoryId: entry.category_id, text: entry.text })),
  };
}

export function loadTemplate(yaml: string): TemplateSnapshot {
  return fromParsed(templateSchema.parse(parse(yaml)));
}

// For templates that never existed as a file, e.g. one a user assembles by hand in the
// workspace app. Same schema, same errors, just skipping the YAML parse step.
export function parseTemplateObject(value: unknown): TemplateSnapshot {
  return fromParsed(templateSchema.parse(value));
}
