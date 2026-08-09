import type { TemplatePrivacyRule } from "@tracepack/evidence-core";

const supported = new Map<string, "pdf" | "image">([
  ["application/pdf", "pdf"],
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
]);

export function inspectFile(file: File) {
  const sourceType = supported.get(file.type);
  if (!sourceType) throw new Error("Tracepack currently supports PDF, JPG, PNG and WebP files.");
  return { sourceType, mimeType: file.type, size: file.size, originalFileName: file.name };
}

export async function sha256(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function inspectPdf(file: Blob, extraRules: TemplatePrivacyRule[] = []) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  const findings: PrivacyFinding[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const textItems = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item);
    const { pageText, findings: pageFindings } = locatePagePrivacyFindings(textItems, pageNumber, findings.length, extraRules);
    pages.push(pageText);
    findings.push(...pageFindings);
  }
  const text = pages.filter(Boolean).join("\n\n");
  return { pageCount: document.numPages, text, findings, textStatus: text ? "complete" as const : "no_text_layer" as const };
}

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export type PrivacyFindingField = "title" | "filename" | "body";

// decision is the full review-state union, not just "unreviewed", even though every finding
// this module constructs starts unreviewed by construction — redactText and
// rescanFieldFindings below both need to operate on findings a human has already reviewed
// (decision "keep"/"remove"), and this stays the one PrivacyFinding shape in the module
// rather than a second, narrower type existing only for scan output.
//
// field is optional, not because this module ever omits it (locatePagePrivacyFindings and
// detectPrivacyFindings both always set it), but so this type stays structurally identical
// to evidence-core's PrivacyFinding — which must accept findings created before this field
// existed — letting callers pass an EvidenceItem's real privacyFindings array here without
// a cast in either direction.
export interface PrivacyFinding {
  id: string;
  kind: PrivacyMatch["kind"];
  label: string;
  value: string;
  excerpt: string;
  decision: "unreviewed" | "keep" | "remove";
  field?: PrivacyFindingField;
  location?: { pageNumber: number; x: number; y: number; width: number; height: number };
}

// Scans a whole page's text (not one text-run at a time) so PII split across adjacent
// pdf.js text items — common with justified or kerned text — is still detected, and
// maps every match back to a bounding box so it is always redactable.
export function locatePagePrivacyFindings(items: PdfTextItem[], pageNumber: number, findingIdOffset = 0, extraRules: TemplatePrivacyRule[] = []) {
  let pageText = "";
  const itemRanges: Array<{ start: number; end: number; item: PdfTextItem }> = [];
  let previous: { endX: number; y: number; height: number } | undefined;
  for (const item of items) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const height = item.height || Math.abs(item.transform[3] ?? 0) || 1;
    // pdf.js frequently splits one logical string across adjacent items (kerning, justification)
    // with no space character between them. Only insert a synthetic space when the horizontal
    // gap or line change looks like a genuine word/line break, so split PII is still joined.
    if (previous) {
      const sameLine = Math.abs(y - previous.y) <= Math.max(1, previous.height * 0.5);
      const gap = x - previous.endX;
      if (!sameLine || gap > Math.max(1, previous.height * 0.2)) pageText += " ";
    }
    const start = pageText.length;
    pageText += item.str;
    itemRanges.push({ start, end: pageText.length, item });
    previous = { endX: x + item.width, y, height };
  }
  const findings: PrivacyFinding[] = scanPrivacyMatches(pageText, extraRules).map((match, index) => {
    const matchEnd = match.index + match.length;
    const overlapping = itemRanges.filter((range) => range.start < matchEnd && range.end > match.index);
    const rects = (overlapping.length ? overlapping : itemRanges).map(({ item }) => ({
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: Math.max(item.width, 1),
      height: Math.max(item.height || Math.abs(item.transform[3] ?? 0), 1),
    }));
    const x = rects.length ? Math.min(...rects.map((rect) => rect.x)) : 0;
    const y = rects.length ? Math.min(...rects.map((rect) => rect.y)) : 0;
    const right = rects.length ? Math.max(...rects.map((rect) => rect.x + rect.width)) : 1;
    const bottom = rects.length ? Math.max(...rects.map((rect) => rect.y + rect.height)) : 1;
    return {
      id: `${match.kind}-page-${pageNumber}-${findingIdOffset + index}`,
      kind: match.kind,
      label: match.label,
      value: match.value,
      excerpt: match.excerpt,
      decision: "unreviewed",
      field: "body",
      location: { pageNumber, x, y, width: Math.max(right - x, 1), height: Math.max(bottom - y, 1) },
    };
  });
  return { pageText: pageText.replace(/\s+/g, " ").trim(), findings };
}

export async function renderPdfPage(file: Blob, canvas: HTMLCanvasElement, pageNumber = 1) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await document.getPage(Math.min(Math.max(1, pageNumber), document.numPages));
  const viewport = page.getViewport({ scale: 1.25 });
  canvas.width = viewport.width; canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas preview is unavailable.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return document.numPages;
}

// Deliberately small: genuinely universal shapes only, nothing tied to one country or domain
// (per strategy doc §7.1). UK postcode and National Insurance detection used to live here —
// they're template-declared privacy_rules now (see templates/consumer-complaint/template.yaml),
// since a National Insurance number is exactly the kind of "quietly UK-shaped" assumption a
// template for a different jurisdiction should never inherit for free. payment_card stays
// built-in because its accuracy depends on the Luhn checksum below, a validation step a plain
// declarative "regex + label + kind" template rule has no way to express.
const privacyPatterns = [
  { kind: "email", label: "Email address", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "phone", label: "Phone number", regex: /(?<!\d)(?:\+44\s?\d{2,4}|0\d{2,4})[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\d)/g },
  { kind: "payment_card", label: "Possible payment card", regex: /\b(?:\d[ -]*?){13,19}\b/g, validate: isLikelyCardNumber },
] as const;

export type PrivacyMatch = {
  kind: string;
  label: string;
  value: string;
  excerpt: string;
  index: number;
  length: number;
};

// Template-declared rules are plain "regex + label + kind", never a function — turning that
// into a live RegExp is the only compilation step, no template-supplied code ever executes.
// template-engine already validates each pattern AND its flags together compile at
// template-load time (see its zod schema's privacyRuleSchema); this try/catch is defense in
// depth so one bad rule can never take an import down, not the only thing standing between a
// broken template and a rule that was promised but silently never runs.
function compileTemplateRules(rules: TemplatePrivacyRule[]): Array<{ kind: string; label: string; regex: RegExp }> {
  const compiled: Array<{ kind: string; label: string; regex: RegExp }> = [];
  for (const rule of rules) {
    try {
      const flags = rule.flags?.includes("g") ? rule.flags : `${rule.flags ?? ""}g`;
      compiled.push({ kind: rule.kind, label: rule.label, regex: new RegExp(rule.pattern, flags) });
    } catch { /* invalid pattern, already flagged at template-load time; skip rather than crash a scan */ }
  }
  return compiled;
}

// Luhn checksum: rejects most non-card digit runs (invoice numbers, tracking IDs,
// timestamps) that would otherwise match the 13-19 digit length pattern.
function isLikelyCardNumber(raw: string): boolean {
  const digits = raw.replace(/[ -]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (alternate) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

// extraRules are a template's own privacy_rules -- merged in only while that template is
// active, never mutating the universal set above. A rule with no validate function, matched
// exactly like the built-ins.
export function scanPrivacyMatches(text: string, extraRules: TemplatePrivacyRule[] = []): PrivacyMatch[] {
  const patterns = [...privacyPatterns, ...compileTemplateRules(extraRules)];
  return patterns.flatMap(({ kind, label, regex, ...rest }) => {
    const validate = "validate" in rest ? rest.validate : undefined;
    return Array.from(text.matchAll(regex))
      .filter((match) => !validate || validate(match[0]))
      .map((match) => {
        const index = match.index ?? 0;
        const start = Math.max(0, index - 38);
        const end = Math.min(text.length, index + match[0].length + 38);
        return { kind, label, value: match[0], excerpt: text.slice(start, end).replace(/\s+/g, " "), index, length: match[0].length };
      });
  });
}

// field defaults to "body" so callers scanning extracted document/note text (the original
// use of this function) don't need to change; title/filename scans pass it explicitly.
// The field is prefixed into the id so title, filename and body scans of the same item
// never collide even if they happen to match the same text at the same offset.
export function detectPrivacyFindings(text: string, field: PrivacyFindingField = "body", extraRules: TemplatePrivacyRule[] = []) {
  return scanPrivacyMatches(text, extraRules).map((match, index) => ({
    id: `${field}-${match.kind}-${match.index}-${index}`,
    kind: match.kind,
    label: match.label,
    value: match.value,
    excerpt: match.excerpt,
    decision: "unreviewed" as const,
    field,
  }));
}

// Findings with no `location` (title/filename matches) can't be flattened into a page
// image — the only redaction that makes sense for a plain string is replacing the matched
// substring outright. Only `decision === "remove"` findings are applied; "keep" and
// "unreviewed" findings never alter the text a viewer sees.
export function redactText(text: string, findings: PrivacyFinding[]): string {
  let result = text;
  for (const finding of findings) {
    if (finding.decision !== "remove") continue;
    result = result.split(finding.value).join("[redacted]");
  }
  return result;
}

// Re-scanning title/filename text always produces fresh, unreviewed results — but a human
// may already have decided an earlier finding at the same (field, kind, value). Matching on
// those three and carrying the old id/decision forward is what makes it safe to call this
// on every title edit and again as a final sweep before export, without ever reverting an
// already-reviewed decision back to unreviewed or losing it if the item is re-scanned.
// Findings whose text no longer appears (the title/filename changed) are simply dropped —
// stale findings must not linger and block export forever.
function mergeFieldFindings(existing: PrivacyFinding[], fresh: PrivacyFinding[]): PrivacyFinding[] {
  return fresh.map((freshFinding) => {
    const match = existing.find((old) => old.field === freshFinding.field && old.kind === freshFinding.kind && old.value === freshFinding.value);
    return match ? { ...freshFinding, id: match.id, decision: match.decision } : freshFinding;
  });
}

// Scans title and (if present) originalFileName for PII and merges the result into
// `existingFindings`, leaving any "body" findings (PDF page text) completely untouched.
// Safe to call on creation, on every title edit, and again as a final sweep immediately
// before export — see mergeFieldFindings for why re-running this never loses a decision.
// A finding with no `field` at all predates this feature and is treated as "body", exactly
// like every other body-finding check in this module.
export function rescanFieldFindings(title: string, filename: string | undefined, existingFindings: PrivacyFinding[], extraRules: TemplatePrivacyRule[] = []): PrivacyFinding[] {
  const bodyFindings = existingFindings.filter((finding) => (finding.field ?? "body") === "body");
  const existingFieldFindings = existingFindings.filter((finding) => finding.field === "title" || finding.field === "filename");
  const fresh = [...detectPrivacyFindings(title, "title", extraRules), ...(filename ? detectPrivacyFindings(filename, "filename", extraRules) : [])];
  return [...bodyFindings, ...mergeFieldFindings(existingFieldFindings, fresh)];
}
