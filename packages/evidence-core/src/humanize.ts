// A filename is a fine unique identifier but a poor evidence title: "title-doc.pdf" and
// "condition1.jpg" as-is read as raw filesystem noise in the evidence index and export, not
// a real title. This turns the name into something presentable without inventing content that
// was not in the filename.

function isAcronymOrCode(word: string): boolean {
  // All-uppercase (optionally with digits) of length > 1 reads as an acronym or code (IMG, PDF,
  // VIN) and should not be lowercased into "Img". A lone letter still gets normal capitalization.
  return word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
}

function capitalizeWord(word: string): string {
  if (isAcronymOrCode(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function humanizeFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./]+$/, "");
  // Deliberately does NOT touch internal dots (only underscores/hyphens): a filename can
  // legitimately embed something dot-shaped worth detecting as-is, e.g. an email address a
  // producer named a file after ("complaint-alex@example.com.png") — turning "example.com"
  // into "example com" would silently break that pattern before the PII scanner ever sees the
  // title. A stray "Archive.tar" instead of "Archive Tar" is a fine trade for that.
  const spaced = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (!spaced) return withoutExtension || filename;

  return spaced.split(" ").map(capitalizeWord).join(" ");
}
