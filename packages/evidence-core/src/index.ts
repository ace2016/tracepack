export type Requirement = "required" | "recommended" | "optional";
// Open, not closed: categories were already template-extensible (a template declares its own
// category IDs), but the *kind* of evidence a category accepts was still pinned to exactly
// four values, the same closed-union problem PrivacyFindingKind had. Real import/inspection
// (inspectFile in document-engine) and template-engine's accepted_types schema still only
// recognise "pdf" | "image" | "note" | "webpage" today -- opening this type removes the
// structural ceiling without pretending upload support for other kinds exists yet. Any kind
// export-engine doesn't know how to render gets an explicit notice page, never a silent drop.
export type SourceType = string;
export type ReviewStatus = "needs_review" | "reviewed" | "has_warning" | "excluded";

export interface EvidenceCategory {
  id: string;
  name: string;
  requirement: Requirement;
  description: string;
  acceptedTypes: SourceType[];
  // Optional: how many items this category needs to count as satisfied. Undefined/1 keeps
  // today's ">0 items" behaviour (see getCategoryProgress) — a template only needs this when
  // "at least one" genuinely isn't enough, e.g. Provenance Trace wanting several condition
  // photos, not the same closed-union problem as PrivacyFindingKind/SourceType, just a plain
  // number a template can opt into.
  minItems?: number;
  // Optional Tracepack-owned tag for a semantic concept a category represents, e.g.
  // "correspondence". Not part of the frozen tracepack-evidence v1 payload contract (a
  // producer never sends this), and not the same thing as `id`, which differs per template
  // even for categories serving the same concept ("supporting evidence" on one template,
  // "correspondence" on another). Lets a payload's evidence_type be routed by what it
  // represents rather than a hardcoded, template-specific category id, see
  // guessCategoryByRole in apps/workspace/src/captures.ts.
  role?: string;
}

// A template-declared PII pattern: "regex + label + kind", deliberately no code-level
// validation hook (that would mean executing template-supplied logic, not just matching a
// template-supplied pattern). Merged with document-engine's small universal built-in set
// (email, phone, payment card) only while that template is the active one — see §7.1 of the
// strategy doc: PrivacyFindingKind must not silently assume every deployment is UK-shaped.
export interface TemplatePrivacyRule {
  kind: string;
  label: string;
  pattern: string;
  flags?: string;
}

// A gap in a pack's chronology worth surfacing: dated evidence exists on both sides of a
// window wider than maxGapDays with nothing in between. Optional — a template with no
// continuity requirement (most of them) simply doesn't declare this.
export interface TemplateChronologyRules {
  maxGapDays: number;
}

// Contextual help shown near a specific category, e.g. "make sure the date is visible in the
// document" — authored per template, not hardcoded per category id in the UI.
export interface TemplateGuidance {
  categoryId: string;
  text: string;
}

export interface TemplateSnapshot {
  id: string;
  name: string;
  version: string;
  jurisdiction: string;
  categories: EvidenceCategory[];
  exportSections: string[];
  // Optional: lets a template override the "New pack" form's intake copy instead of every
  // template being stuck with consumer-complaint's wording ("What happened", "Desired
  // resolution"). Undefined means "use the same defaults the form has always used", so
  // existing templates and every TemplateSnapshot fixture in this repo need no changes.
  summaryLabel?: string;
  summaryPlaceholder?: string;
  resolutionLabel?: string;
  resolutionPlaceholder?: string;
  privacyRules?: TemplatePrivacyRule[];
  chronologyRules?: TemplateChronologyRules;
  guidance?: TemplateGuidance[];
}

export interface EvidenceItem {
  id: string;
  projectId: string;
  title: string;
  categoryId: string;
  sourceType: SourceType;
  originalFileName?: string;
  sourceUrl?: string;
  importedAt: string;
  eventDate?: string;
  contentHash: string;
  reviewStatus: ReviewStatus;
  notes: string;
  size: number;
  mimeType: string;
  pageCount?: number;
  extractedText?: string;
  textExtractionStatus?: "pending" | "complete" | "no_text_layer" | "failed";
  privacyFindings?: PrivacyFinding[];
  // Set only when this item was created by an external producer via the evidence
  // interchange format (packages/evidence-interchange), never by Tracepack's own file
  // import or capture paths. Its presence is what lets export/render code tell "Tracepack
  // organised this" apart from "a third party supplied this and Tracepack is relaying it."
  provenance?: EvidenceProvenance;
  // Claims made BY the producer named in `provenance`, not independently verified by
  // Tracepack. Structurally separate from privacyFindings (Tracepack's own PII detector
  // output) on purpose — the two must never be merged or rendered as if they were the same
  // kind of thing. See packages/evidence-interchange/SPEC.md section 4.
  observations?: ExternalObservation[];
}

export interface EvidenceProvenance {
  producerId: string;
  producerName: string;
  producerVersion?: string;
  schemaVersion: 1;
  capturedAt: string;
  sourceUrl?: string;
}

export interface ExternalObservation {
  id: string;
  kind: string;
  label: string;
  detail: string;
  confidence?: number;
  data?: Record<string, unknown>;
}

// Open, not a closed union: the built-in universal patterns (document-engine) use
// "email"/"phone", but a template can declare its own privacy_rules with any kind label
// ("passport_number", "case_reference", ...) — the same way evidence_type in the interchange
// contract is free text rather than a fixed enum. A template shouldn't need a core type change
// to detect something Tracepack's own authors didn't think of.
export type PrivacyFindingKind = string;
export type PrivacyDecision = "unreviewed" | "keep" | "remove";
// Which item field the scan matched in. Absent is treated as "body" for backward
// compatibility with findings created before this field existed (page-located PDF text).
// A "title"/"filename" finding has no `location` — it is never flattened into a page
// image, it is removed by text substitution wherever that field is rendered (see
// document-engine.redactText and export-engine's use of it).
export type PrivacyFindingField = "title" | "filename" | "body";

export interface PrivacyFinding {
  id: string;
  kind: PrivacyFindingKind;
  label: string;
  value: string;
  excerpt: string;
  decision: PrivacyDecision;
  field?: PrivacyFindingField;
  location?: {
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface TracepackProject {
  id: string;
  schemaVersion: 1;
  title: string;
  organisation: string;
  summary: string;
  desiredResolution: string;
  keyDate?: string;
  createdAt: string;
  updatedAt: string;
  template: TemplateSnapshot;
  evidence: EvidenceItem[];
}

export interface CategoryProgress {
  category: EvidenceCategory;
  itemCount: number;
  complete: boolean;
}

export function getCategoryProgress(project: TracepackProject): CategoryProgress[] {
  return project.template.categories.map((category) => {
    const itemCount = project.evidence.filter(
      (item) => item.categoryId === category.id && item.reviewStatus !== "excluded",
    ).length;
    // minItems defaults to 1 -- today's ">0 items" behaviour for every template that doesn't
    // opt into a higher bar (see EvidenceCategory.minItems).
    return { category, itemCount, complete: itemCount >= (category.minItems ?? 1) };
  });
}

export interface ChronologyGap {
  fromItemId: string;
  fromTitle: string;
  fromDate: string;
  toItemId: string;
  toTitle: string;
  toDate: string;
  days: number;
}

// Real interval reasoning, not a date sort: a window wider than the template's declared
// maxGapDays between two consecutive pieces of dated evidence, with nothing in between. Only
// runs at all when a template opts in (chronologyRules) -- most templates have no continuity
// requirement, and an undated item can't participate on either side of a gap by definition.
export function getChronologyGaps(project: TracepackProject): ChronologyGap[] {
  const rules = project.template.chronologyRules;
  if (!rules) return [];
  const dated = project.evidence
    .filter((item): item is EvidenceItem & { eventDate: string } => item.reviewStatus !== "excluded" && !!item.eventDate)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const gaps: ChronologyGap[] = [];
  for (let i = 1; i < dated.length; i += 1) {
    const from = dated[i - 1]!;
    const to = dated[i]!;
    const days = Math.round((new Date(to.eventDate).getTime() - new Date(from.eventDate).getTime()) / 86_400_000);
    if (days > rules.maxGapDays) {
      gaps.push({ fromItemId: from.id, fromTitle: from.title, fromDate: from.eventDate, toItemId: to.id, toTitle: to.title, toDate: to.eventDate, days });
    }
  }
  return gaps;
}

export function getRequiredSummary(project: TracepackProject) {
  const required = getCategoryProgress(project).filter(
    ({ category }) => category.requirement === "required",
  );
  return {
    complete: required.filter((entry) => entry.complete).length,
    total: required.length,
  };
}

export function createProject(
  input: Pick<TracepackProject, "title" | "organisation" | "summary" | "desiredResolution"> & {
    keyDate?: string;
    template: TemplateSnapshot;
  },
): TracepackProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    ...input,
    createdAt: now,
    updatedAt: now,
    evidence: [],
  };
}

export function addEvidence(project: TracepackProject, item: EvidenceItem): TracepackProject {
  if (!project.template.categories.some((category) => category.id === item.categoryId)) {
    throw new Error("The selected evidence category is not part of this template.");
  }
  return { ...project, evidence: [...project.evidence, item], updatedAt: new Date().toISOString() };
}

export { humanizeFilename } from "./humanize";
export {
  diffManifests,
  looksLikeTracepackManifest,
  type ManifestContentChange,
  type ManifestDiff,
  type ManifestEvidenceEntry,
  type ManifestMetadataChange,
  type TracepackManifest,
} from "./manifest";
