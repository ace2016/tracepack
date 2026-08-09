import type { EvidenceCategory, EvidenceItem, TemplateSnapshot, TracepackProject } from "@tracepack/evidence-core";
import { addEvidence } from "@tracepack/evidence-core";
import { saveEvidenceFile } from "@tracepack/storage";

interface CaptureJob { id: string; url: string; title: string; capturedAt: string; screenshotDataUrl: string; status: "pending" | "completed" | "failed"; error?: string; mode?: "viewport" | "full-page"; truncated?: boolean }
interface ExtensionStorage { get(key: string): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void> }
const key = "tracepackCaptureJobs";

function storage(): ExtensionStorage | undefined {
  return (globalThis as typeof globalThis & { chrome?: { storage?: { local?: ExtensionStorage } } }).chrome?.storage?.local;
}

// A captured page's title and URL are the only signal available at capture time, so this
// is a rough keyword guess, not real classification — it just beats always defaulting to
// the first webpage category regardless of what the page actually was. Users can still
// recategorise any item from the workspace.
const categoryHints: Array<{ pattern: RegExp; categoryId: string }> = [
  { pattern: /(terms|policy|policies|returns?|refund|warrant)/, categoryId: "terms_and_policy" },
  { pattern: /(order|receipt|invoice|confirmation|checkout|purchase)/, categoryId: "proof_of_purchase" },
  { pattern: /(contact|support|help|correspond|ticket|message|live-chat)/, categoryId: "correspondence" },
  { pattern: /(product|item|listing|spec)/, categoryId: "product_information" },
];

// Widened to { title, url } rather than the full CaptureJob shape (which it never actually
// reads beyond those two fields) so externalImport.ts's postMessage evidence handoff can reuse
// the exact same keyword table instead of maintaining a second, drifting copy.
// The fallback below used to end with `?? categories.find((entry) => entry.acceptedTypes
// .includes("image"))` -- a hardcoded last resort that ignored the actual requested
// acceptedType entirely. That was already questionable for the original webpage-capture
// caller (a capture's real sourceType is "webpage", not "image" -- see importPendingCaptures
// below -- so it could file a capture under a category that never actually declared it accepts
// that item's type). It became a real bug once externalImport.ts started calling this with
// "pdf" and "note" too: a template with no PDF-accepting category but SOME image-accepting
// category would get that image category back for a PDF attachment, silently passing
// resolveCategoryId's "does a category exist" contract even though the category doesn't
// accept PDFs at all -- exactly the misfiling bug that contract exists to prevent, just moved
// one layer down. This must never return a category that doesn't accept the requested type;
// returning undefined here is the correct "nothing fits" answer, not an excuse to guess wrong.
export function guessCategory(job: { title: string; url: string }, categories: EvidenceCategory[], acceptedType: "webpage" | "pdf" | "image" | "note" = "webpage"): EvidenceCategory | undefined {
  const haystack = `${job.title} ${job.url}`.toLowerCase();
  for (const hint of categoryHints) {
    if (!hint.pattern.test(haystack)) continue;
    const match = categories.find((entry) => entry.id === hint.categoryId && entry.acceptedTypes.includes(acceptedType));
    if (match) return match;
  }
  return categories.find((entry) => entry.acceptedTypes.includes(acceptedType));
}

// A lightweight peek used on the home screen, before any project exists to import into.
// Without this, a page captured from the extension sits invisibly in chrome.storage.local
// until the user happens to create or open a project, with nothing on screen suggesting
// there is anything waiting.
export async function countPendingCaptures(): Promise<number> {
  const local = storage(); if (!local) return 0;
  const result = await local.get(key); const jobs = (result[key] as CaptureJob[] | undefined) ?? [];
  return jobs.filter((entry) => entry.status === "pending").length;
}

// Same peek, but the page's title/URL rather than a count — the only signal available before
// a pack exists to recommend a template against. Deliberately the smallest useful slice of a
// CaptureJob (not the screenshot bytes), since this runs on every home-screen visit.
export async function peekLatestPendingCapture(): Promise<{ title: string; url: string } | undefined> {
  const local = storage(); if (!local) return undefined;
  const result = await local.get(key); const jobs = (result[key] as CaptureJob[] | undefined) ?? [];
  const pending = jobs.filter((entry) => entry.status === "pending");
  const latest = pending[pending.length - 1];
  return latest ? { title: latest.title, url: latest.url } : undefined;
}

// Same rough keyword-matching idea as guessCategory above, one level up: which *template*
// fits a captured page, not just which category inside one. A user who captures an auction
// listing shouldn't have to already know Provenance Trace exists to land on it.
const templateHints: Array<{ pattern: RegExp; templateId: string }> = [
  { pattern: /(auction|classic|vintage|collector|memorabilia|provenance|restoration|\bvin\b|vehicle|\bcar\b)/, templateId: "provenance-trace" },
  { pattern: /(order|receipt|invoice|checkout|refund|return|warranty|complaint|dispute|faulty)/, templateId: "consumer-complaint" },
];

export function guessTemplate(job: { title: string; url: string }, templates: TemplateSnapshot[]): TemplateSnapshot | undefined {
  const haystack = `${job.title} ${job.url}`.toLowerCase();
  for (const hint of templateHints) {
    if (!hint.pattern.test(haystack)) continue;
    const match = templates.find((tpl) => tpl.id === hint.templateId);
    if (match) return match;
  }
  return undefined;
}

// onlyJobId narrows this to a single capture instead of sweeping in every pending job -- used
// by the popup's post-capture pack picker, where the UI shows one specific just-finished
// capture and lets the user choose which pack it goes into. Without this, choosing a pack for
// that one capture would also silently import any other unrelated pending captures still
// queued from earlier, potentially filing sensitive evidence into the wrong pack. Omitted
// entirely (the default, used everywhere else this is called), it keeps the original
// sweep-everything-pending behaviour: opening a pack from the home screen, or creating a new
// one, is still meant to pick up whatever is waiting.
export async function importPendingCaptures(project: TracepackProject, onlyJobId?: string) {
  const local = storage(); if (!local) return project;
  const result = await local.get(key); const jobs = (result[key] as CaptureJob[] | undefined) ?? [];
  let next = project; let changed = false;
  for (const job of jobs.filter((entry) => entry.status === "pending" && (!onlyJobId || entry.id === onlyJobId))) {
    if (next.evidence.some((item) => item.id === job.id)) { job.status = "completed"; changed = true; continue; }
    try {
      const response = await fetch(job.screenshotDataUrl); const blob = await response.blob();
      const category = guessCategory(job, next.template.categories);
      if (!category) throw new Error("This template has no webpage evidence category.");
      const captureNote = job.mode === "full-page"
        ? `Full-page screenshot captured by the Tracepack extension (scrolled and stitched).${job.truncated ? " The page was very long, so this capture covers the top portion only." : ""}`
        : "Visible-page screenshot captured by the Tracepack extension.";
      const item: EvidenceItem = { id: job.id, projectId: next.id, title: job.title, categoryId: category.id, sourceType: "webpage", sourceUrl: job.url, importedAt: job.capturedAt, contentHash: await hash(blob), reviewStatus: "needs_review", notes: captureNote, size: blob.size, mimeType: "image/png" };
      await saveEvidenceFile(item.id, blob); next = addEvidence(next, item); job.status = "completed"; changed = true;
    } catch (error) { job.status = "failed"; job.error = error instanceof Error ? error.message : "Import failed"; changed = true; }
  }
  // Once a capture is safely stored in the workspace's own evidence store, drop it
  // (screenshot bytes included) from extension storage rather than retaining a second,
  // less visible copy of what is often the most PII-dense evidence in the product.
  if (changed) await local.set({ [key]: jobs.filter((entry) => entry.status !== "completed") });
  return next;
}

async function hash(blob: Blob) { const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
