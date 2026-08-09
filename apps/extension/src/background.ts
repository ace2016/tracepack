import { CAPTURE_JOBS_KEY, type CaptureJob } from "./types";

// Only on a fresh install, not on every extension reload/update during development,
// and not on Chrome itself updating — reason is exactly "install" once, the first time.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, respond) => {
  if (message.type === "CAPTURE_PAGE") {
    void capture("viewport").then((result) => respond({ ok: true, ...result })).catch((error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : "Capture failed" }));
    return true;
  }
  if (message.type === "CAPTURE_FULL_PAGE") {
    void capture("full-page").then((result) => respond({ ok: true, ...result })).catch((error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : "Capture failed" }));
    return true;
  }
  return undefined;
});

// Deliberately does not open the workspace tab itself. The popup shows the captured image
// and lets the user choose "download" or "open in Tracepack" explicitly, rather than a tab
// appearing whether they wanted one or not. The job is still queued here either way, so
// choosing "open in Tracepack" later (from the popup or the workspace home screen) still
// finds it waiting.
async function capture(mode: "viewport" | "full-page"): Promise<{ truncated: boolean; screenshotDataUrl: string; jobId: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("Tracepack cannot access this tab.");
  if (!/^https?:/.test(tab.url)) throw new Error("Only normal web pages can be captured.");

  const { screenshotDataUrl, truncated } = mode === "full-page"
    ? await captureFullPage(tab.id, tab.windowId)
    : { screenshotDataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }), truncated: false };

  const stored = await chrome.storage.local.get(CAPTURE_JOBS_KEY);
  const jobs = (stored[CAPTURE_JOBS_KEY] as CaptureJob[] | undefined) ?? [];
  const job: CaptureJob = { id: crypto.randomUUID(), url: tab.url, title: tab.title || tab.url, capturedAt: new Date().toISOString(), screenshotDataUrl, status: "pending", mode, truncated };
  await chrome.storage.local.set({ [CAPTURE_JOBS_KEY]: [...jobs, job] });
  return { truncated, screenshotDataUrl, jobId: job.id };
}

interface PageMetrics { scrollHeight: number; viewportHeight: number; viewportWidth: number; devicePixelRatio: number; originalScrollY: number }

// Injected into the page via chrome.scripting.executeScript — must be self-contained
// (no closure over anything outside its own body), which is why this stays a free function
// rather than a method that could reach for module-level state.
function readPageMetrics(): PageMetrics {
  return {
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    originalScrollY: window.scrollY,
  };
}

function scrollToY(y: number) {
  window.scrollTo(0, y);
}

// Long enough for most sticky headers, lazy-loaded images and scroll-triggered animations
// to settle after each scroll before the next capture, without making a many-slice page
// take unreasonably long. captureVisibleTab is also rate-limited by Chrome itself
// (a handful of calls per second), so this delay doubles as staying under that quota.
const SCROLL_SETTLE_MS = 550;
// A hard ceiling on stitched output height, comfortably under browser canvas size limits,
// and a hard ceiling on slice count independent of height (guards a pathological page with
// a tiny viewport). Either one can be hit; when either is, the capture is marked truncated
// rather than silently missing the bottom of the page with no indication anything was cut.
const MAX_STITCHED_HEIGHT = 12000;
const MAX_SLICES = 20;

async function captureFullPage(tabId: number, windowId: number): Promise<{ screenshotDataUrl: string; truncated: boolean }> {
  const [{ result: metrics }] = await chrome.scripting.executeScript({ target: { tabId }, func: readPageMetrics });
  if (!metrics) throw new Error("Tracepack could not measure this page.");

  const totalHeight = Math.min(metrics.scrollHeight, MAX_STITCHED_HEIGHT);
  const truncatedByHeight = metrics.scrollHeight > MAX_STITCHED_HEIGHT;
  const maxScrollY = Math.max(0, totalHeight - metrics.viewportHeight);

  const slices: Array<{ y: number; dataUrl: string }> = [];
  let y = 0;
  let previousTargetY = -1;
  let truncatedBySliceCap = false;
  while (slices.length < MAX_SLICES) {
    const targetY = Math.min(y, maxScrollY);
    if (targetY === previousTargetY) break;
    await chrome.scripting.executeScript({ target: { tabId }, func: scrollToY, args: [targetY] });
    await new Promise((resolve) => setTimeout(resolve, SCROLL_SETTLE_MS));
    const dataUrl = await captureVisibleTabWithRetry(windowId);
    slices.push({ y: targetY, dataUrl });
    previousTargetY = targetY;
    if (targetY >= maxScrollY) break;
    y += metrics.viewportHeight;
    if (slices.length >= MAX_SLICES && targetY < maxScrollY) truncatedBySliceCap = true;
  }

  await chrome.scripting.executeScript({ target: { tabId }, func: scrollToY, args: [metrics.originalScrollY] });

  const screenshotDataUrl = await stitchSlices(slices, metrics.viewportWidth, totalHeight, metrics.devicePixelRatio);
  return { screenshotDataUrl, truncated: truncatedByHeight || truncatedBySliceCap };
}

// chrome.tabs.captureVisibleTab enforces a short-window call-rate limit; one retry after a
// pause covers the case where SCROLL_SETTLE_MS wasn't quite enough headroom, without
// silently failing an otherwise-good full-page capture on a transient quota error.
async function captureVisibleTabWithRetry(windowId: number): Promise<string> {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    } catch {
      throw error instanceof Error ? error : new Error("Tracepack could not capture this page.");
    }
  }
}

async function stitchSlices(slices: Array<{ y: number; dataUrl: string }>, viewportWidth: number, totalHeight: number, devicePixelRatio: number): Promise<string> {
  if (slices.length === 0) throw new Error("Tracepack captured no content from this page.");
  const canvas = new OffscreenCanvas(Math.round(viewportWidth * devicePixelRatio), Math.round(totalHeight * devicePixelRatio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Tracepack could not assemble the full-page capture.");
  for (const slice of slices) {
    const response = await fetch(slice.dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    context.drawImage(bitmap, 0, Math.round(slice.y * devicePixelRatio));
    bitmap.close();
  }
  const outputBlob = await canvas.convertToBlob({ type: "image/png" });
  return await blobToDataUrl(outputBlob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error instanceof Error ? reader.error : new Error("Tracepack could not read the assembled capture."));
    reader.readAsDataURL(blob);
  });
}
