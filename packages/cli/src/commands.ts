// Pure validation logic, separated from file I/O and process exit codes so it's directly
// testable without touching the filesystem — src/cli.ts is a thin argv/stdout wrapper around
// these functions.
import { loadTemplate } from "@tracepack/template-engine";
import { validateEvidencePayload } from "@tracepack/evidence-sdk";
import { diffManifests, looksLikeTracepackManifest, type ManifestEvidenceEntry, type TracepackManifest } from "@tracepack/evidence-core";

export interface CheckResult {
  ok: boolean;
  message: string;
}

function formatZodError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues)) {
    const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return issues.map((issue) => `  [${issue.path.join(".") || "root"}] ${issue.message}`).join("\n");
  }
  return error instanceof Error ? `  ${error.message}` : `  ${String(error)}`;
}

/** Validates template.yaml *content* (already read from disk) against the real schema
 *  template-engine loads every shipped template with — not a separate, looser check. */
export function checkTemplateYaml(yamlText: string): CheckResult {
  try {
    const template = loadTemplate(yamlText);
    const categoryCount = template.categories.length;
    return { ok: true, message: `Valid template "${template.name}" (${template.id}) — ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}.` };
  } catch (error) {
    return { ok: false, message: `Invalid template:\n${formatZodError(error)}` };
  }
}

/** Validates tracepack-evidence v1 payload JSON *content* (already read from disk) against the
 *  same schema Tracepack's own import pipeline validates against. Structural/semantic only —
 *  matches validateEvidencePayload's own documented scope, not attachment/payload hash
 *  verification (that requires decoding attachment bytes, which happens on real import). */
export function checkEvidenceJson(jsonText: string): CheckResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }

  const result = validateEvidencePayload(parsed);
  if (result.ok) {
    const { attachments, observations, source } = result.payload;
    return {
      ok: true,
      message: `Valid tracepack-evidence v1 payload from "${source.producer_name}" — ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}, ${observations.length} observation${observations.length === 1 ? "" : "s"}.\n(This checks shape and required fields only — it does not verify attachment/payload hashes, which requires the real import step.)`,
    };
  }
  return {
    ok: false,
    message: `Invalid payload:\n${result.issues.map((issue) => `  [${issue.path || "root"}] ${issue.message}`).join("\n")}`,
  };
}

function parseManifestOrError(jsonText: string, label: "before" | "after"): { manifest: TracepackManifest } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return { error: `Invalid JSON in the "${label}" manifest: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!looksLikeTracepackManifest(parsed)) {
    return { error: `The "${label}" file does not look like a Tracepack manifest.json (expected a "format": "tracepack-source-manifest" object with an "evidence" array).` };
  }
  return { manifest: parsed };
}

function describeEntry(entry: ManifestEvidenceEntry): string {
  return `${entry.id} ("${entry.title}")`;
}

/**
 * Diffs two exported manifest.json files (downloaded from the workspace app, or extracted
 * from a .tracepack bundle) by evidence item id + contentHash. Exit status: ok is false only
 * when at least one item's contentHash changed under the same id -- Tracepack's export
 * guarantee is that an item's original bytes are never mutated (see ARCHITECTURE.md), so that
 * specific case is treated as a real failure worth failing a CI check on. Additions, removals,
 * and ordinary metadata edits (title, category, review status) are expected, normal states and
 * do not fail the command -- they are still reported in full, per this project's "show gaps,
 * do not hide them" principle (see ARCHITECTURE.md's design principles).
 */
export function checkManifestDiff(beforeJsonText: string, afterJsonText: string): CheckResult {
  const before = parseManifestOrError(beforeJsonText, "before");
  if ("error" in before) return { ok: false, message: before.error };
  const after = parseManifestOrError(afterJsonText, "after");
  if ("error" in after) return { ok: false, message: after.error };

  const diff = diffManifests(before.manifest, after.manifest);
  const lines: string[] = [];

  if (diff.contentChanged.length > 0) {
    lines.push(`ANOMALY: ${diff.contentChanged.length} item(s) changed contentHash under the same id -- this should never happen for a genuine Tracepack export:`);
    for (const change of diff.contentChanged) {
      lines.push(`  ! ${describeEntry(change.before)}: ${change.before.contentHash} -> ${change.after.contentHash}`);
    }
  }
  if (diff.added.length > 0) {
    lines.push(`Added (${diff.added.length}):`);
    for (const entry of diff.added) lines.push(`  + ${describeEntry(entry)}`);
  }
  if (diff.removed.length > 0) {
    lines.push(`Removed (${diff.removed.length}):`);
    for (const entry of diff.removed) lines.push(`  - ${describeEntry(entry)}`);
  }
  if (diff.metadataChanged.length > 0) {
    lines.push(`Metadata changed (${diff.metadataChanged.length}):`);
    for (const change of diff.metadataChanged) lines.push(`  ~ ${describeEntry(change.after)}: ${change.changedFields.join(", ")}`);
  }
  lines.push(`${diff.unchangedCount} item(s) unchanged.`);

  return { ok: diff.contentChanged.length === 0, message: lines.join("\n") };
}
