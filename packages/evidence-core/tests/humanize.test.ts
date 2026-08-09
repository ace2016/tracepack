import { describe, expect, it } from "vitest";
import { humanizeFilename } from "../src/humanize";

describe("humanizeFilename", () => {
  it("turns hyphens into spaces and title-cases each word", () => {
    expect(humanizeFilename("title-doc.pdf")).toBe("Title Doc");
  });

  it("turns underscores into spaces and title-cases each word", () => {
    expect(humanizeFilename("my_receipt_file.png")).toBe("My Receipt File");
  });

  it("splits a trailing number off the word it's attached to", () => {
    expect(humanizeFilename("condition1.jpg")).toBe("Condition 1");
  });

  it("splits camelCase into separate words", () => {
    expect(humanizeFilename("camelCaseFile.jpg")).toBe("Camel Case File");
  });

  it("keeps an all-uppercase run as an acronym instead of lowercasing it", () => {
    expect(humanizeFilename("IMG_20230501_123456.jpg")).toBe("IMG 20230501 123456");
  });

  it("only strips the final extension, leaving other dots in the name untouched", () => {
    expect(humanizeFilename("archive.tar.gz")).toBe("Archive.tar");
  });

  it("never breaks a dot-shaped pattern like an email address embedded in the filename", () => {
    // Regression: an earlier version replaced every dot with a space, which turned
    // "example.com" into "example com" -- silently breaking the email pattern before the PII
    // scanner (packages/document-engine) ever saw the humanized title. See
    // packages/evidence-interchange/tests/pdf-pii-scan.test.ts for the PII-detection side of
    // this same guarantee.
    expect(humanizeFilename("complaint-alex@example.com.png")).toBe("Complaint Alex@example.com");
  });

  it("leaves an already well-formed title effectively as-is, just re-cased per word", () => {
    expect(humanizeFilename("Receipt for June order.pdf")).toBe("Receipt For June Order");
  });

  it("falls back to the extension-stripped name when nothing alphanumeric survives", () => {
    expect(humanizeFilename("___.pdf")).toBe("___");
  });

  it("handles a name with no extension at all", () => {
    expect(humanizeFilename("condition-photo")).toBe("Condition Photo");
  });
});
