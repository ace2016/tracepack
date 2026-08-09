import { listProjects } from "@tracepack/storage";

const captureView = document.querySelector<HTMLElement>("#captureView");
const ownPageView = document.querySelector<HTMLElement>("#ownPageView");
const doneView = document.querySelector<HTMLElement>("#doneView");
const button = document.querySelector<HTMLButtonElement>("#capture");
const fullPageButton = document.querySelector<HTMLButtonElement>("#captureFull");
const statusElement = document.querySelector<HTMLElement>("#status");
const openWorkspaceButton = document.querySelector<HTMLButtonElement>("#openWorkspace");
const thumb = document.querySelector<HTMLImageElement>("#captureThumb");
const doneStatus = document.querySelector<HTMLElement>("#doneStatus");
const downloadLink = document.querySelector<HTMLAnchorElement>("#downloadCapture");
const openWorkspaceFromDoneButton = document.querySelector<HTMLButtonElement>("#openWorkspaceFromDone");
const captureAnotherButton = document.querySelector<HTMLButtonElement>("#captureAnother");
const packPicker = document.querySelector<HTMLElement>("#packPicker");
const packList = document.querySelector<HTMLElement>("#packList");

// The popup has no idea what tab it's floating over until it asks. Without this check,
// clicking capture while already inside Tracepack's own workspace tab (or on a chrome://
// page) just fails with "Only normal web pages can be captured" — a dead end instead of
// a useful next step.
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const capturable = tab?.url && /^https?:/.test(tab.url);
  if (!capturable) { captureView?.setAttribute("hidden", ""); ownPageView?.removeAttribute("hidden"); }
}
void init();

// The popup used to close itself the moment a capture finished, so the only feedback was
// whatever the user glimpsed in the status line before it vanished. There was no way to see
// the image, download it directly, or decide whether to bother opening the workspace at all.
// Now a successful capture switches to a "done" view showing the actual screenshot with an
// explicit download link, and leaves opening the workspace as something the user chooses.
async function runCapture(type: "CAPTURE_PAGE" | "CAPTURE_FULL_PAGE", busyText: string) {
  if (button) button.disabled = true;
  if (fullPageButton) fullPageButton.disabled = true;
  if (statusElement) statusElement.textContent = busyText;
  const result = await chrome.runtime.sendMessage({ type }) as { ok: boolean; error?: string; truncated?: boolean; screenshotDataUrl?: string; jobId?: string };
  if (!result.ok || !result.screenshotDataUrl) {
    if (statusElement) statusElement.textContent = result.error || "Capture failed.";
    if (button) button.disabled = false;
    if (fullPageButton) fullPageButton.disabled = false;
    return;
  }
  showDone(result.screenshotDataUrl, result.truncated ?? false, result.jobId);
}

function showDone(screenshotDataUrl: string, truncated: boolean, jobId: string | undefined) {
  captureView?.setAttribute("hidden", "");
  doneView?.removeAttribute("hidden");
  if (thumb) thumb.src = screenshotDataUrl;
  if (doneStatus) doneStatus.textContent = truncated ? "Saved locally. Page was very long, capture covers the top portion." : "Saved locally to this browser.";
  if (downloadLink) downloadLink.href = screenshotDataUrl;
  void renderPackPicker(jobId);
}

// The popup and the workspace tab are the same extension origin (chrome-extension://<id>/...
// regardless of path), so this reads the exact same IndexedDB data the workspace app itself
// uses — no message-passing round trip needed. Letting the user pick the destination pack
// right here, instead of always landing on the home screen and taking a second step to find
// it, is the point: capture -> pick a pack -> land directly in that pack with the capture
// already there.
async function renderPackPicker(jobId: string | undefined) {
  if (!packPicker || !packList || !openWorkspaceFromDoneButton) return;
  let projects: Awaited<ReturnType<typeof listProjects>> = [];
  try { projects = await listProjects(); } catch { /* IndexedDB unavailable; fall back to the generic action below */ }

  packList.innerHTML = "";
  if (projects.length === 0) {
    packPicker.setAttribute("hidden", "");
    openWorkspaceFromDoneButton.textContent = "Add to a Tracepack project";
    return;
  }

  for (const project of projects) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "pack-btn";
    const name = document.createElement("span");
    name.textContent = project.title;
    const count = document.createElement("span");
    count.className = "pack-count";
    count.textContent = `${project.evidence.length} item${project.evidence.length === 1 ? "" : "s"}`;
    item.append(name, count);
    item.addEventListener("click", () => {
      // &job=<id> scopes the import to this one just-captured screenshot -- without it, this
      // click would also sweep in any other unrelated captures still pending from earlier
      // (see the matching comment on importPendingCaptures in apps/workspace/src/captures.ts).
      const jobParam = jobId ? `&job=${encodeURIComponent(jobId)}` : "";
      void chrome.tabs.create({ url: chrome.runtime.getURL(`workspace/index.html?open=${encodeURIComponent(project.id)}${jobParam}`) });
      window.close();
    });
    packList.appendChild(item);
  }
  packPicker.removeAttribute("hidden");
  openWorkspaceFromDoneButton.textContent = "Create a new pack";
}

button?.addEventListener("click", () => void runCapture("CAPTURE_PAGE", "Capturing visible page…"));
fullPageButton?.addEventListener("click", () => void runCapture("CAPTURE_FULL_PAGE", "Capturing full page — scrolling and stitching…"));

openWorkspaceButton?.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("workspace/index.html") });
  window.close();
});

openWorkspaceFromDoneButton?.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("workspace/index.html") });
  window.close();
});

captureAnotherButton?.addEventListener("click", () => {
  doneView?.setAttribute("hidden", "");
  captureView?.removeAttribute("hidden");
  if (statusElement) statusElement.textContent = "";
  if (button) button.disabled = false;
  if (fullPageButton) fullPageButton.disabled = false;
});

export {};
