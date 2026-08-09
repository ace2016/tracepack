// The "Send to Tracepack" embed contract: a third-party site (a gift shop's refund form, a
// housing site's deposit-claim page) opens Tracepack in a new tab and hands off a
// tracepack-evidence v1 payload via postMessage. Nothing here talks to a server -- the payload
// moves directly from the sender's tab to this one, the same way it would if the user had typed
// it in themselves. See templates/../EMBED_GUIDE.md for the sender-side half of this contract
// and examples/embed/gift-shop-refund-button/ for a worked, framework-free example.
import { validateEvidencePayload, type TracepackEvidencePayloadV1, type ValidationIssue } from "@tracepack/evidence-sdk";
import { importEvidencePayload } from "@tracepack/evidence-interchange";
import type { EvidenceCategory, SourceType, TracepackProject } from "@tracepack/evidence-core";
import { guessCategory } from "./captures";

// Namespaced so this never collides with postMessage traffic from something unrelated (a
// browser extension, an ad script, another library) that also happens to be running on
// whichever page opened this tab.
export const READY_MESSAGE = { source: "tracepack", type: "ready" } as const;

export interface ImportedMessage { source: "tracepack"; type: "imported"; projectId: string; evidenceCount: number }
export interface EvidenceMessage { source: "tracepack-producer"; type: "evidence"; payload: unknown }

export function isEvidenceMessage(data: unknown): data is EvidenceMessage {
  return typeof data === "object" && data !== null
    && (data as Record<string, unknown>).source === "tracepack-producer"
    && (data as Record<string, unknown>).type === "evidence";
}

export type IncomingEvidence =
  | { ok: true; payload: TracepackEvidencePayloadV1 }
  | { ok: false; issues: ValidationIssue[] };

/** Structural validation only -- the same check the CLI and evidence-sdk run -- so a broken
 *  or malicious postMessage payload never gets further than this before the user sees why. */
export function checkIncomingEvidence(data: unknown): IncomingEvidence {
  if (!isEvidenceMessage(data)) return { ok: false, issues: [{ path: "", message: "Not a recognised evidence handoff message." }] };
  const result = validateEvidencePayload(data.payload);
  return result.ok ? { ok: true, payload: result.payload } : { ok: false, issues: result.issues };
}

/** Best-effort guess at which category a single source type ("pdf", "image", or "note" for an
 *  attachment-less payload) within the incoming evidence belongs in, from its declared
 *  evidence_type and source_url -- same keyword-matching approach as a captured webpage. Shared
 *  by guessExternalCategory (a whole-payload preview guess, for the common single-type case)
 *  and importExternalEvidence (which resolves one category PER ATTACHMENT, since a payload can
 *  mix attachment types under a template that has separate categories for each). */
function guessExternalCategoryFor(sourceType: "pdf" | "image" | "note", payload: TracepackEvidencePayloadV1, categories: EvidenceCategory[]): EvidenceCategory | undefined {
  const job = { title: payload.evidence_type, url: payload.source_url ?? "" };
  return guessCategory(job, categories, sourceType);
}

/** Best-effort guess at which category the incoming evidence belongs in overall, from its
 *  declared evidence_type and source_url -- same keyword-matching approach and the same "never
 *  a dead end" fallback (first category that accepts *something*) as a captured webpage
 *  already gets. A preview guess for the payload as a whole (used for the review screen before
 *  import); importExternalEvidence below resolves a separate, correct category per attachment
 *  rather than filing every attachment under this single guess. The user can always
 *  recategorise from the workspace afterward. */
export function guessExternalCategory(payload: TracepackEvidencePayloadV1, categories: EvidenceCategory[]): EvidenceCategory | undefined {
  if (payload.attachments.length === 0) return guessExternalCategoryFor("note", payload, categories) ?? guessExternalCategoryFor("pdf", payload, categories);
  const mimeType = payload.attachments[0]!.mime_type;
  return guessExternalCategoryFor(mimeType === "application/pdf" ? "pdf" : "image", payload, categories);
}

/** Imports an already-validated external payload into a project. Resolves a category per
 *  attachment (not one category for the whole payload) -- a payload mixing a PDF and a photo,
 *  say, under a template with separate categories for documents and photos, needs each
 *  attachment routed to the category that actually accepts its type, not all of them filed
 *  under whichever category the first attachment happened to suggest. Throws
 *  EvidenceInterchangeError (from @tracepack/evidence-interchange) on hash mismatch, an
 *  attachment type with no matching category, or any other import-time failure -- the caller
 *  is expected to catch it and show the message, never swallow it, matching how every other
 *  import path in this app surfaces failures. */
export async function importExternalEvidence(project: TracepackProject, payload: TracepackEvidencePayloadV1) {
  const overallGuess = guessExternalCategory(payload, project.template.categories);
  if (!overallGuess) throw new Error("This template has no category that accepts this kind of evidence.");
  const resolveCategoryId = (sourceType: SourceType) => {
    if (sourceType !== "pdf" && sourceType !== "image" && sourceType !== "note") return undefined;
    return guessExternalCategoryFor(sourceType, payload, project.template.categories)?.id;
  };
  const result = await importEvidencePayload(payload, { project, categoryId: overallGuess.id, resolveCategoryId });
  return { project: result.project, evidenceCount: result.createdEvidenceIds.length };
}
