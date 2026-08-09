import { inspectPdf, rescanFieldFindings } from "@tracepack/document-engine";
import { addEvidence, humanizeFilename, type EvidenceItem, type EvidenceProvenance, type ExternalObservation, type SourceType, type TracepackProject } from "@tracepack/evidence-core";
import { saveProjectAndFiles } from "@tracepack/storage";
import { base64ToBytes, computePayloadHash, sha256Hex, validateEvidencePayload, type ObservationV1, type SupportedAttachmentMimeType, type TracepackEvidencePayloadV1, type ValidationIssue } from "@tracepack/evidence-sdk";

export class EvidenceInterchangeError extends Error {
  issues: ValidationIssue[];
  constructor(message: string, issues: ValidationIssue[] = []) {
    super(issues.length ? `${message} ${issues.map((issue) => `[${issue.path || "root"}] ${issue.message}`).join(" ")}` : message);
    this.name = "EvidenceInterchangeError";
    this.issues = issues;
  }
}

export interface ImportEvidenceOptions {
  project: TracepackProject;
  /**
   * The Tracepack category this evidence should be filed under, resolved by the caller
   * (the workspace UI). `category_hint` in the payload is advisory only — a producer cannot
   * know which category ids a given project's active template defines, so Tracepack, not
   * the producer, makes the final call. See SPEC.md section 7.
   *
   * Used for every created item UNLESS `resolveCategoryId` below is provided.
   */
  categoryId: string;
  /**
   * Optional per-item override, called once per created item with its resolved SourceType
   * ("pdf", "image", or "note" for an attachment-less payload). If provided, its result is
   * used INSTEAD of `categoryId` for that item. A payload can mix attachment types (a PDF and
   * a photo in one handoff); a single shared `categoryId` chosen for the whole payload can be
   * wrong for some of its attachments if the template has separate categories per type. When
   * this returns undefined for a given source type, the import is rejected outright rather
   * than silently falling back to `categoryId` anyway -- silently filing an attachment under a
   * category that does not accept its type is exactly the bug this option exists to prevent,
   * not an acceptable fallback. Every caller that omits this keeps `categoryId`'s original
   * single-category behaviour, unchanged.
   */
  resolveCategoryId?: (sourceType: SourceType) => string | undefined;
}

/** Resolves and validates the category id for one created item, per the rules documented on
 *  ImportEvidenceOptions.resolveCategoryId above. Throws before any item is added to
 *  itemsToCreate or any storage write is issued, so a rejection here never leaves the project
 *  partially updated -- same invariant as every other validation step in this function. */
function categoryFor(options: ImportEvidenceOptions, sourceType: SourceType): string {
  const categoryId = options.resolveCategoryId ? options.resolveCategoryId(sourceType) : options.categoryId;
  if (!categoryId) {
    throw new EvidenceInterchangeError(`No category in this project's template accepts evidence of type "${sourceType}".`);
  }
  if (!options.project.template.categories.some((category) => category.id === categoryId)) {
    throw new EvidenceInterchangeError(`Category "${categoryId}" is not part of this project's template.`);
  }
  return categoryId;
}

export interface ImportEvidenceResult {
  /**
   * The project with new evidence added. Already durably persisted — along with every
   * attachment blob, in the same atomic write — by the time this function returns; the
   * caller does not need to (and should not) call saveProject separately for this import.
   * This is a deliberate departure from the "caller persists separately" convention used by
   * apps/workspace/src/App.tsx and captures.ts for manual uploads: those paths persist a
   * single file at a time, where that convention is harmless, but an interchange payload can
   * add several EvidenceItems and blobs in one call, and only this package's import path
   * gets the narrowly-scoped saveProjectAndFiles transaction from packages/storage that
   * makes persisting all of them together, atomically, possible. See SPEC.md section 10.
   */
  project: TracepackProject;
  createdEvidenceIds: string[];
}

function mimeToSourceType(mime: SupportedAttachmentMimeType): SourceType {
  return mime === "application/pdf" ? "pdf" : "image";
}

function toExternalObservation(observation: ObservationV1): ExternalObservation {
  const { attachment_ref: _attachmentRef, ...rest } = observation;
  return rest;
}

function observationsFor(payload: TracepackEvidencePayloadV1, attachmentId: string | undefined): ExternalObservation[] {
  return payload.observations
    .filter((observation) => observation.attachment_ref === undefined || observation.attachment_ref === attachmentId)
    .map(toExternalObservation);
}

/**
 * Renders the text/plain blob that stands in for a file when a payload carries observations
 * but no attachments — see SPEC.md section 6.3. This text (and its contentHash) is a
 * Tracepack-generated artifact, not a document the producer sent and not something Tracepack
 * itself determined. That has to be unmistakable to anyone reading it later — including
 * someone who only sees the exported PDF page this becomes, with no access to this source —
 * because a hash always LOOKS like proof something existed; here it only proves this
 * specific rendering of the producer's claims is byte-identical to what was stored, not that
 * any underlying document existed. The opening banner line exists specifically to prevent
 * that misreading, and must not be trimmed, summarised away, or moved out of the rendered
 * text by anyone editing this function later.
 *
 * Must be a pure, deterministic function of `payload` — no timestamps, random ids, or
 * non-deterministic ordering — since contentHash on the resulting EvidenceItem hashes
 * exactly these bytes, and recomputing the rendering from the same payload has to reproduce
 * the same hash.
 */
function renderObservationsAsText(payload: TracepackEvidencePayloadV1): string {
  const producer = `${payload.source.producer_name}${payload.source.producer_version ? ` v${payload.source.producer_version}` : ""}`;
  const lines = [
    "GENERATED BY TRACEPACK — this page is a rendering of claims reported by an external",
    `producer (${producer}). It is not an original document supplied by that producer, and`,
    "it is not a finding Tracepack itself determined. Tracepack did not independently verify",
    "any of the statements below. See the \"Producer identity\" note in this evidence pack's",
    "manifest for what the hash of this page does and does not prove.",
    "",
    payload.evidence_type,
    `Source: ${producer}`,
    `Captured: ${payload.capture_timestamp}`,
    "",
  ];
  for (const observation of payload.observations) {
    lines.push(observation.label, observation.detail);
    if (observation.confidence !== undefined) lines.push(`Confidence (producer-reported): ${observation.confidence}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Validate, hash-verify, and import a tracepack-evidence payload into an existing project.
 *
 * All validation and hash verification happens before any EvidenceItem is created or any
 * storage write is issued — a failure at any point (schema, version, hash mismatch, unknown
 * category) throws before touching project or storage state, so a rejected import never
 * leaves the project partially updated.
 *
 * The final persistence step is genuinely atomic, not just ordered: every derived
 * EvidenceItem's blob and the updated project document are written together inside
 * packages/storage's saveProjectAndFiles, which wraps both stores in one IndexedDB
 * transaction and explicitly aborts it on any failure — including a failure that only
 * manifests partway through, after some blobs already looked queued. Either every write in
 * this call commits, or none does; see SPEC.md section 10 and
 * packages/storage/tests/storage.test.ts for the failure-mode tests that prove it (including
 * two real bugs an earlier, ordered-but-not-transactional version of this had: a request
 * that fails synchronously doesn't auto-abort the transaction the way an async request
 * failure does, and an `await` between queuing writes gives IndexedDB a window to
 * auto-commit early — both closed in saveProjectAndFiles, not worked around here).
 */
export async function importEvidencePayload(input: unknown, options: ImportEvidenceOptions): Promise<ImportEvidenceResult> {
  const validation = validateEvidencePayload(input);
  if (!validation.ok) throw new EvidenceInterchangeError("The evidence payload is invalid.", validation.issues);
  const payload = validation.payload;

  // Resolved and validated up front, for every source type this payload will actually need a
  // category for, before any hash verification or item construction starts -- so a category
  // problem (including one only resolveCategoryId would catch, e.g. a mixed-type payload with
  // no category for one of its types) is rejected as early as every other validation failure,
  // not partway through building items.
  const neededSourceTypes = payload.attachments.length === 0
    ? (["note"] as const)
    : [...new Set(payload.attachments.map((attachment) => mimeToSourceType(attachment.mime_type)))];
  const resolvedCategoryIds = new Map(neededSourceTypes.map((sourceType) => [sourceType, categoryFor(options, sourceType)]));

  const expectedPayloadHash = await computePayloadHash(payload);
  if (expectedPayloadHash !== payload.integrity.payload_hash) {
    throw new EvidenceInterchangeError("The payload integrity hash does not match the payload contents. The structured claims may have been altered in transit.");
  }

  const decodedAttachments = new Map<string, Blob>();
  for (const attachment of payload.attachments) {
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(attachment.data); }
    catch { throw new EvidenceInterchangeError(`Attachment "${attachment.id}" data is not valid base64.`); }
    if (bytes.length !== attachment.size) {
      throw new EvidenceInterchangeError(`Attachment "${attachment.id}" declared size ${attachment.size} but decoded to ${bytes.length} bytes.`);
    }
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== attachment.content_hash) {
      throw new EvidenceInterchangeError(`Attachment "${attachment.id}" content hash does not match its declared content_hash. The attachment may be corrupted or altered.`);
    }
    decodedAttachments.set(attachment.id, new Blob([bytes.buffer as ArrayBuffer], { type: attachment.mime_type }));
  }

  const provenance: EvidenceProvenance = {
    producerId: payload.source.producer_id,
    producerName: payload.source.producer_name,
    producerVersion: payload.source.producer_version,
    schemaVersion: payload.schema_version,
    capturedAt: payload.capture_timestamp,
    sourceUrl: payload.source_url,
  };

  const itemsToCreate: Array<{ item: EvidenceItem; blob: Blob }> = [];

  if (payload.attachments.length === 0) {
    const summary = renderObservationsAsText(payload);
    const blob = new Blob([summary], { type: "text/plain" });
    const contentHash = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
    itemsToCreate.push({
      blob,
      item: {
        id: crypto.randomUUID(), projectId: options.project.id, title: payload.evidence_type,
        categoryId: resolvedCategoryIds.get("note")!, sourceType: "note", sourceUrl: payload.source_url,
        importedAt: new Date().toISOString(), contentHash, reviewStatus: "needs_review", notes: "",
        size: blob.size, mimeType: "text/plain", extractedText: summary, textExtractionStatus: "complete",
        provenance, observations: observationsFor(payload, undefined),
        // The title here is producer-supplied (evidence_type) — scanned exactly like a
        // manually-typed note title, same as the attachment path below.
        privacyFindings: rescanFieldFindings(payload.evidence_type, undefined, [], options.project.template.privacyRules),
      },
    });
  } else {
    for (const attachment of payload.attachments) {
      const blob = decodedAttachments.get(attachment.id);
      if (!blob) continue;
      const sourceType = mimeToSourceType(attachment.mime_type);
      const item: EvidenceItem = {
        id: crypto.randomUUID(), projectId: options.project.id,
        title: attachment.filename ? humanizeFilename(attachment.filename) : payload.evidence_type,
        categoryId: resolvedCategoryIds.get(sourceType)!, sourceType,
        originalFileName: attachment.filename, sourceUrl: payload.source_url,
        importedAt: new Date().toISOString(), contentHash: attachment.content_hash, reviewStatus: "needs_review", notes: "",
        size: attachment.size, mimeType: attachment.mime_type,
        provenance, observations: observationsFor(payload, attachment.id),
      };
      // A PDF handed to Tracepack by an external producer must go through the same PII
      // scan a manually-uploaded PDF does (see apps/workspace/src/App.tsx), or it silently
      // skips the redact-or-leave-as-is review queue — the producer isn't Tracepack and
      // isn't trusted to have checked for PII, same as any other untrusted attachment.
      if (attachment.mime_type === "application/pdf") {
        const inspected = await inspectPdf(blob, options.project.template.privacyRules);
        item.pageCount = inspected.pageCount;
        item.extractedText = inspected.text;
        item.textExtractionStatus = inspected.textStatus;
        item.privacyFindings = inspected.findings;
      }
      // The title (derived from the producer's filename) and originalFileName itself are
      // both producer-supplied and untrusted — scanned the same as a manually-uploaded
      // file's name, merged alongside any body findings from the PDF scan above.
      item.privacyFindings = rescanFieldFindings(item.title, item.originalFileName, item.privacyFindings ?? [], options.project.template.privacyRules);
      itemsToCreate.push({ blob, item });
    }
  }

  let project = options.project;
  for (const { item } of itemsToCreate) project = addEvidence(project, item);

  const files = new Map(itemsToCreate.map(({ item, blob }) => [item.id, blob]));
  await saveProjectAndFiles(project, files);

  return { project, createdEvidenceIds: itemsToCreate.map(({ item }) => item.id) };
}
