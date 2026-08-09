import { describe, expect, it } from "vitest";
import { detectPrivacyFindings, locatePagePrivacyFindings, redactText, rescanFieldFindings, type PdfTextItem, type PrivacyFinding } from "../src/index";

function item(str: string, x: number, width = str.length * 6): PdfTextItem {
  return { str, transform: [1, 0, 0, 1, x, 700], width, height: 10 };
}

function finding(value: string, decision: PrivacyFinding["decision"]): PrivacyFinding {
  return { id: `f-${value}`, kind: "email", label: "Email address", value, excerpt: value, decision, field: "title" };
}

describe("privacy pattern detection", () => {
  it("flags universal patterns without changing the source text, and does not assume a UK jurisdiction by default", () => {
    // Postcode and National Insurance formats are UK-specific -- strategy doc §7.1 -- so with
    // no template rules supplied, only the genuinely universal email pattern should fire here.
    const source = "Contact alex@example.com at SW1A 1AA. NI number AB 12 34 56 C.";
    const findings = detectPrivacyFindings(source);
    expect(findings.map((finding) => finding.kind)).toEqual(["email"]);
    expect(findings.every((finding) => finding.decision === "unreviewed")).toBe(true);
    expect(source).toContain("alex@example.com");
  });

  it("flags a digit run that passes the card-number checksum", () => {
    const findings = detectPrivacyFindings("Card on file: 4111 1111 1111 1111.");
    expect(findings.filter((finding) => finding.kind === "payment_card").map((finding) => finding.value)).toEqual(["4111 1111 1111 1111"]);
  });

  it("does not flag same-length digit runs that fail the checksum", () => {
    const findings = detectPrivacyFindings("Invoice reference 4012 8888 8888 1882 was issued on 2024-05-01.");
    expect(findings.filter((finding) => finding.kind === "payment_card")).toHaveLength(0);
  });

  it("defaults field to \"body\", and tags it explicitly when a field is passed — used for title/filename scans, which have no page location", () => {
    const bodyFindings = detectPrivacyFindings("Contact alex@example.com.");
    expect(bodyFindings[0]?.field).toBe("body");

    const titleFindings = detectPrivacyFindings("Refund for alex@example.com", "title");
    expect(titleFindings[0]?.field).toBe("title");

    const filenameFindings = detectPrivacyFindings("alex@example.com.pdf", "filename");
    expect(filenameFindings[0]?.field).toBe("filename");
  });

  it("keeps ids unique across a title scan and a body scan that match the same text", () => {
    const titleFindings = detectPrivacyFindings("alex@example.com", "title");
    const bodyFindings = detectPrivacyFindings("alex@example.com", "body");
    expect(titleFindings[0]?.id).not.toBe(bodyFindings[0]?.id);
  });
});

describe("template-declared privacy_rules", () => {
  const ukRules = [
    { kind: "postcode", label: "UK postcode", pattern: "\\b(?:GIR\\s?0AA|[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2})\\b", flags: "gi" },
    { kind: "national_insurance", label: "National Insurance number", pattern: "\\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z]{2}\\s?\\d{2}\\s?\\d{2}\\s?\\d{2}\\s?[A-D]\\b", flags: "gi" },
    { kind: "driving_licence", label: "UK driving licence number", pattern: "\\b[A-Z9]{5}\\d{6}[A-Z9]{2}\\d[A-Z]{2}\\b", flags: "g" },
  ];

  it("detects a template-declared UK postcode/NI rule only when the caller supplies it, never by default", () => {
    const source = "Contact alex@example.com at SW1A 1AA. NI number AB 12 34 56 C.";
    const withRules = detectPrivacyFindings(source, "body", ukRules);
    expect(withRules.map((f) => f.kind).sort()).toEqual(["email", "national_insurance", "postcode"]);
    const withoutRules = detectPrivacyFindings(source);
    expect(withoutRules.map((f) => f.kind)).toEqual(["email"]);
  });

  it("detects a UK driving licence number in the standard 16-character format", () => {
    // MORGA657054SM9IJ: a standard-format example (surname-derived letters, encoded DOB,
    // initials, check digit, trailing pair) -- not a real person's licence.
    const findings = detectPrivacyFindings("Licence number MORGA657054SM9IJ on file.", "body", ukRules);
    expect(findings.map((f) => f.kind)).toEqual(["driving_licence"]);
    expect(findings[0]?.value).toBe("MORGA657054SM9IJ");
  });

  it("detects a genuinely novel kind that exists nowhere in this codebase, declared purely by a template", () => {
    // The actual proof this mechanism is real: a kind this module has never heard of ("vin"),
    // detected purely because a template declared the pattern -- not because it was added to
    // the built-in list.
    const vinRule = [{ kind: "vin", label: "Vehicle Identification Number", pattern: "\\b[A-HJ-NPR-Z0-9]{17}\\b" }];
    const findings = detectPrivacyFindings("Chassis: 1HGCM82633A004352 confirmed.", "body", vinRule);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("vin");
    expect(findings[0]?.value).toBe("1HGCM82633A004352");
  });

  it("never lets a malformed template pattern crash a scan -- skips it, keeps everything else working", () => {
    const badRule = [{ kind: "broken", label: "Broken rule", pattern: "(unclosed" }];
    const findings = detectPrivacyFindings("Contact alex@example.com.", "body", badRule);
    expect(findings.map((f) => f.kind)).toEqual(["email"]);
  });

  it("rescanFieldFindings applies the same template rules to title/filename scans", () => {
    const findings = rescanFieldFindings("Registered keeper postcode SW1A 1AA", undefined, [], ukRules);
    expect(findings.map((f) => f.kind)).toEqual(["postcode"]);
  });
});

describe("redactText", () => {
  it("replaces the value of every 'remove' finding, and leaves 'keep'/'unreviewed' findings untouched", () => {
    const findings = [
      finding("alex@example.com", "remove"),
      finding("SW1A 1AA", "keep"),
      finding("07700 900123", "unreviewed"),
    ];
    const result = redactText("Contact alex@example.com or visit SW1A 1AA, call 07700 900123.", findings);
    expect(result).toBe("Contact [redacted] or visit SW1A 1AA, call 07700 900123.");
  });

  it("replaces every occurrence of a repeated value, not just the first", () => {
    const findings = [finding("alex@example.com", "remove")];
    const result = redactText("alex@example.com appears twice: alex@example.com.", findings);
    expect(result).toBe("[redacted] appears twice: [redacted].");
  });

  it("returns the original text unchanged when there is nothing to remove", () => {
    const findings = [finding("alex@example.com", "keep")];
    expect(redactText("Contact alex@example.com.", findings)).toBe("Contact alex@example.com.");
  });
});

describe("rescanFieldFindings", () => {
  it("finds PII in the title and, when present, the filename", () => {
    const findings = rescanFieldFindings("Refund for alex@example.com", "invoice-alex@example.com.pdf", []);
    expect(findings.map((f) => f.field).sort()).toEqual(["filename", "title"]);
  });

  it("preserves an existing decision for a finding whose (field, kind, value) is unchanged", () => {
    const first = rescanFieldFindings("Refund for alex@example.com", undefined, []);
    const decided = first.map((f) => ({ ...f, decision: "remove" as const }));
    const rescanned = rescanFieldFindings("Refund for alex@example.com", undefined, decided);
    expect(rescanned[0]?.decision).toBe("remove");
    expect(rescanned[0]?.id).toBe(decided[0]?.id);
  });

  it("drops a finding once the matching text is edited away, instead of leaving it stuck", () => {
    const first = rescanFieldFindings("Refund for alex@example.com", undefined, []);
    const decided = first.map((f) => ({ ...f, decision: "remove" as const }));
    const rescanned = rescanFieldFindings("Refund, no PII here", undefined, decided);
    expect(rescanned).toHaveLength(0);
  });

  it("never touches existing 'body' findings", () => {
    const bodyFinding: PrivacyFinding = { id: "b1", kind: "email", label: "Email address", value: "keep@example.com", excerpt: "keep@example.com", decision: "unreviewed", field: "body", location: { pageNumber: 1, x: 0, y: 0, width: 1, height: 1 } };
    const rescanned = rescanFieldFindings("A clean title", undefined, [bodyFinding]);
    expect(rescanned).toEqual([bodyFinding]);
  });
});

describe("page-level PII location", () => {
  it("still detects PII split across separate text-content items with no space between them", () => {
    // pdf.js commonly reports one PII string as several adjacent items (kerning, justification)
    // with no literal space character at the split point.
    const items = [item("Contact ", 20), item("alex@example", 68), item(".com", 140), item(" for details.", 164)];
    const { pageText, findings } = locatePagePrivacyFindings(items, 3);
    expect(pageText).toBe("Contact alex@example.com for details.");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toBeDefined();
    expect(findings[0]?.value).toBe("alex@example.com");
    expect(findings[0]?.location?.pageNumber).toBe(3);
  });

  it("still inserts a word break when items are genuinely separated on the page", () => {
    const items = [item("alex", 20, 24), item("example.com", 400, 66)];
    const { pageText, findings } = locatePagePrivacyFindings(items, 1);
    expect(pageText).toBe("alex example.com");
    expect(findings.map((finding) => finding.value)).not.toContain("alexexample.com");
  });

  it("always attaches a redactable location, unioning the bounding boxes of every item the match spans", () => {
    const items = [item("secret@", 20, 42), item("example.com", 62, 66)];
    const { findings } = locatePagePrivacyFindings(items, 1);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toBeDefined();
    const location = findings[0]?.location;
    expect(location?.x).toBe(20);
    expect(location?.width).toBeCloseTo(62 + 66 - 20, 5);
  });
});
