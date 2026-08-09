// Automated Chromium smoke test for the Tracepack extension build.
//
// Loads the real unpacked `dist/` output (the artifact users install) in a
// persistent Chromium context, then drives the workspace app through its
// core journey: create a project, import a PDF whose PII is split across
// two adjacent text runs with no space between them (the exact pattern
// pdf.js produces for kerned/justified text and the case the privacy-scan
// fix in packages/document-engine addresses), mark the finding for
// removal, export the PDF pack, and confirm the plaintext PII is not
// present in the exported bytes. It then imports a WebP image and confirms
// it is embedded in a re-exported pack instead of being dropped.
//
// This does not replace manual testing — see e2e/CHROME_EDGE_CHECKLIST.md
// for what still needs a human on real Chrome and Edge.
//
// Run with: pnpm --filter @tracepack/extension e2e

import { chromium } from "playwright";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDist = join(here, "..", "dist");
const sandboxChromium = "/opt/pw-browsers/chromium";

function assert(condition, message) {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
}

// The export screen's primary button plays a multi-second assembling animation before
// revealing the file in an overlay opened as a blob URL in a new tab, not a real download.
// The "More export options" panel's "PDF evidence pack" button skips the animation and
// downloads directly, which is what a download-event-based assertion actually needs.
async function downloadPdfPack(page) {
  await page.getByRole("button", { name: /More export options/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    // Scoped to .more-panel: the big primary button above it is labelled "Export PDF
    // evidence pack", which also matches a loose /PDF evidence pack/ pattern.
    page.locator(".more-panel").getByRole("button", { name: /PDF evidence pack/ }).click(),
  ]);
  return download;
}

async function buildSplitPiiPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 200]);
  const size = 14;
  const prefix = "Contact ";
  const part1 = "alex@example";
  const part2 = ".com";
  page.drawText(prefix, { x: 20, y: 140, font, size });
  const prefixWidth = font.widthOfTextAtSize(prefix, size);
  page.drawText(part1, { x: 20 + prefixWidth, y: 140, font, size });
  const part1Width = font.widthOfTextAtSize(part1, size);
  // No gap and no space character between this run and the previous one —
  // this is what a real PDF looks like when a renderer splits one string
  // into multiple text-show operations (kerning pairs, justification).
  page.drawText(part2, { x: 20 + prefixWidth + part1Width, y: 140, font, size });
  return Buffer.from(await doc.save());
}

async function main() {
  assert(existsSync(extensionDist), `extension dist not found at ${extensionDist} — run "pnpm build" first`);

  const fixtureDir = mkdtempSync(join(tmpdir(), "tracepack-e2e-"));
  const pdfPath = join(fixtureDir, "split-pii.pdf");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(pdfPath, await buildSplitPiiPdf());

  const userDataDir = mkdtempSync(join(tmpdir(), "tracepack-profile-"));
  const launchOptions = {
    headless: false,
    // Chromium's extension APIs are unavailable in classic headless mode, and this needs to
    // run on a CI runner with no display server at all -- "--headless=new" is Chromium's own
    // headless mode that still supports loading unpacked extensions, so this runs the same way
    // in a container as it does on a developer machine with a real screen.
    args: [`--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`, "--headless=new"],
  };
  if (existsSync(sandboxChromium)) launchOptions.executablePath = sandboxChromium;

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).hostname;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/workspace/index.html`);

    // A fresh profile has no "tracepack-introduction-complete" flag, so the onboarding
    // modal covers the hero on this first load, same as it would for a real first-time
    // user -- skip it the way a user would rather than special-casing the app for tests.
    const skipOnboarding = page.locator(".ws-ob-skip");
    if (await skipOnboarding.isVisible({ timeout: 5000 }).catch(() => false)) {
      await skipOnboarding.click();
    }

    // The hero's "Create a pack" button always starts the first (default) template regardless
    // of how many templates exist, unlike the empty-state chips, which show each template's
    // real name once there is more than one, so this stays stable as templates are added.
    await page.locator(".hero button", { hasText: "Create a pack" }).click();
    await page.locator('input[name="title"]').fill("Smoke test project");
    await page.getByRole("button", { name: "Create pack" }).click();

    await page.waitForSelector(".workspace-title");
    await page.locator('input[type="file"]').setInputFiles(pdfPath);

    const privacyButton = page.getByRole("button", { name: /Privacy review \(1\)/ });
    await privacyButton.waitFor({ timeout: 15000 });
    await privacyButton.click();

    const findingCard = page.locator(".finding-card").first();
    await findingCard.waitFor();
    const findingValue = await findingCard.locator("h3").innerText();
    assert(findingValue === "alex@example.com", `expected the split-run email to be detected whole, got "${findingValue}"`);

    const removeButton = findingCard.getByRole("button", { name: "Mark for removal" });
    assert(await removeButton.isEnabled(), "finding has no redaction location — it could never be removed from the export");
    await removeButton.click();

    await page.getByRole("button", { name: "← Back to workspace" }).click();
    await page.getByRole("button", { name: "Preview export" }).click();

    const download = await downloadPdfPack(page);
    const downloadPath = await download.path();
    assert(downloadPath, "the evidence pack did not download");
    const exportedBytes = readFileSync(downloadPath);
    assert(exportedBytes.subarray(0, 4).toString() === "%PDF", "downloaded file is not a PDF");
    assert(!exportedBytes.includes(Buffer.from("alex@example.com")), "the exported PDF still contains the redacted email in plaintext");
    const pageCountBefore = (await PDFDocument.load(exportedBytes)).getPageCount();

    console.log("Redaction check passed: split-run PII was detected, marked for removal, and flattened out of the exported PDF.");

    // WebP export: pdf-lib can't embed WebP directly, so buildEvidencePack converts it
    // via canvas first. Generate a real WebP in the browser itself (guarantees valid
    // encoding) rather than hand-crafting fixture bytes.
    const webpDataUrl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 40; canvas.height = 40;
      const context = canvas.getContext("2d");
      context.fillStyle = "#2266aa"; context.fillRect(0, 0, 40, 40);
      return canvas.toDataURL("image/webp");
    });
    assert(webpDataUrl.startsWith("data:image/webp"), "this browser build did not produce a WebP canvas export — cannot verify WebP import/export");
    const webpPath = join(fixtureDir, "swatch.webp");
    writeFileSync(webpPath, Buffer.from(webpDataUrl.split(",")[1], "base64"));

    await page.getByRole("button", { name: "← Back to workspace" }).click();
    await page.locator('input[type="file"]').setInputFiles(webpPath);
    await page.locator(".evidence-list .evidence-card", { hasText: "swatch" }).waitFor({ timeout: 10000 });

    await page.getByRole("button", { name: "Preview export" }).click();
    const webpDownload = await downloadPdfPack(page);
    const webpDownloadPath = await webpDownload.path();
    assert(webpDownloadPath, "the evidence pack did not download after adding the WebP image");
    const webpExportedBytes = readFileSync(webpDownloadPath);
    const pageCountAfter = (await PDFDocument.load(webpExportedBytes)).getPageCount();
    assert(pageCountAfter === pageCountBefore + 1, `expected the WebP image to add exactly one page (was ${pageCountBefore}, now ${pageCountAfter}) — it may have been silently dropped again`);

    console.log("WebP check passed: a WebP image was imported and embedded in the exported PDF instead of being dropped.");
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
