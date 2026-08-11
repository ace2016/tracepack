import { useEffect, useRef, useState, type FormEvent } from "react";
import { addEvidence, createProject, getCategoryProgress, getChronologyGaps, getRequiredSummary, humanizeFilename, type EvidenceCategory, type EvidenceItem, type PrivacyFinding, type Requirement, type SourceType, type TemplateSnapshot, type TracepackProject } from "@tracepack/evidence-core";
import { detectPrivacyFindings, inspectFile, inspectPdf, renderPdfPage, rescanFieldFindings, sha256 } from "@tracepack/document-engine";
import { buildEvidencePack, downloadEpackBundle, downloadJson, downloadTracepackBundle } from "@tracepack/export-engine";
import { deleteProject, getEvidenceFile, getProject, listProjects, saveEvidenceFile, saveProject } from "@tracepack/storage";
import { parseTemplateObject } from "@tracepack/template-engine";
import { templates } from "./template";
import { countPendingCaptures, explainTemplateMatch, guessTemplate, importPendingCaptures, jobFromExternalPayload, peekLatestPendingCapture, seedFromExternalPayload } from "./captures";
import { checkIncomingEvidence, importExternalEvidence, isEvidenceMessage, READY_MESSAGE } from "./externalImport";
import type { TracepackEvidencePayloadV1 } from "@tracepack/evidence-sdk";
import { Onboarding } from "./Onboarding";

type View = "home" | "new" | "custom" | "workspace" | "privacy" | "timeline" | "export" | "external-import";
type SaveState = "saved" | "saving" | "failed";

// Local storage can fail for reasons the user can actually act on (a full quota) or
// reasons they can't (storage blocked entirely) — surface which one happened instead
// of a generic message, and never let a failure pass silently, especially on delete.
function describeStorageError(error: unknown): string {
  if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22)) {
    return "Local storage is full. Free up space in this browser (or remove older packs) and try again.";
  }
  // Safari's Private Browsing mode restricts IndexedDB and refuses to store Blob/File data at
  // all, throwing this exact message. The generic error.message fallback below would otherwise
  // surface that raw browser string verbatim, which does not tell anyone what to actually do.
  if (error instanceof DOMException && error.message.includes("preparing Blob/File data")) {
    return "Private Browsing mode in Safari cannot store files for this app. Open it in a regular tab instead and try again.";
  }
  if (error instanceof Error) return error.message;
  return "Local storage is unavailable in this browser. Private browsing modes or storage-blocking settings can cause this.";
}

function Mark() {
  return <svg className="mark" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M34 18 H66 A10 10 0 0 1 76 28 V72 A10 10 0 0 1 66 82 H34 A10 10 0 0 1 24 72 V28 A10 10 0 0 1 34 18 Z" fill="#d5f66b" />
    <path d="M41 44 A9 9 0 1 1 59 44 A9 9 0 1 1 41 44 Z" fill="#1d3c2d" />
    <path d="M49 50 H51 A3 3 0 0 1 54 53 V65 A3 3 0 0 1 51 68 H49 A3 3 0 0 1 46 65 V53 A3 3 0 0 1 49 50 Z" fill="#1d3c2d" />
  </svg>;
}

export function App() {
  const [showOnboarding, setShowOnboarding] = useState(() => {
    // Never show the intro over a tab someone was sent to for a specific reason -- a
    // "Send to Tracepack" handoff (?send-to-tracepack=1) or an extension pack-picker link
    // (?open=<id>) both land on a screen the visitor is already mid-task on (reviewing
    // incoming evidence, or a specific pack), and a first-time visitor's browser has no
    // "tracepack-introduction-complete" flag set yet either way -- so this has to be checked
    // here, synchronously, in the same render the two query-param effects below read from,
    // not as a separate effect that could still let onboarding flash up first.
    const params = new URLSearchParams(window.location.search);
    if (params.has("send-to-tracepack") || params.has("open")) return false;
    try { return window.localStorage.getItem("tracepack-introduction-complete") !== "yes"; }
    catch { return true; }
  });
  const [view, setView] = useState<View>("home");
  const [projects, setProjects] = useState<TracepackProject[]>([]);
  const [project, setProject] = useState<TracepackProject>();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState("");
  const [appError, setAppError] = useState("");
  const [pendingCaptures, setPendingCaptures] = useState(0);
  const [recommendedTemplate, setRecommendedTemplate] = useState<TemplateSnapshot>();
  const [recommendationReason, setRecommendationReason] = useState<string>();
  const [pendingExternalPayload, setPendingExternalPayload] = useState<TracepackEvidencePayloadV1>();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSnapshot>(templates[0]!);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewContent = useRef<HTMLDivElement>(null);

  // This is a single-page app with no router and no full page navigation, so switching
  // `view` swaps the entire content block without a browser navigation event. Without
  // this, keyboard and screen-reader users get no cue they moved to a new "page" and
  // focus is left on a now-unmounted button. Skipped while the onboarding dialog is open:
  // on first mount both this and Onboarding's own focus-in effect would otherwise fire,
  // and this one would win since it runs after the child's, pulling focus out of the dialog.
  useEffect(() => { if (!showOnboarding) viewContent.current?.focus(); }, [view]);

  // A page captured from the extension queues invisibly in chrome.storage.local until it is
  // imported into a specific project; re-checking whenever the home screen becomes active
  // (not just once on mount) means a capture made while this tab was already open still
  // shows up as soon as the user comes back to home, rather than only after a fresh load.
  useEffect(() => { if (view === "home") void countPendingCaptures().then(setPendingCaptures); }, [view]);

  // Same idea, one screen earlier: peek what the waiting capture actually was (not just how
  // many) and guess which template fits it, so a user who captured an auction listing sees
  // Provenance Trace suggested instead of having to already know it exists. A pending external
  // payload (the "Send to Tracepack" handoff, see ExternalImport below) is checked and scored
  // against its own text via jobFromExternalPayload. It takes priority over a capture peek
  // since a pending external payload is what actually sent the user to this screen.
  useEffect(() => {
    if (view !== "home") { setRecommendedTemplate(undefined); setRecommendationReason(undefined); return; }
    function apply(job: { title: string; url: string } | undefined) {
      const match = job ? guessTemplate(job, templates) : undefined;
      setRecommendedTemplate(match);
      setRecommendationReason(match && job ? explainTemplateMatch(job, match.id) : undefined);
    }
    if (pendingExternalPayload) { apply(jobFromExternalPayload(pendingExternalPayload)); return; }
    void peekLatestPendingCapture().then(apply);
  }, [view, pendingCaptures, pendingExternalPayload]);

  const refresh = async () => {
    try { setProjects(await listProjects()); setAppError(""); }
    catch (error) { setAppError(describeStorageError(error)); }
  };
  useEffect(() => { void refresh(); }, []);

  // The extension popup's pack picker links straight here with ?open=<id> instead of
  // dropping the user on home and making them find the right pack themselves. Reusing the
  // same `open()` used for clicking a pack card on home means a queued capture still gets
  // picked up (importPendingCaptures runs inside open() either way). The query param is
  // stripped afterward so reloading this tab later does not keep re-triggering it.
  //
  // The optional &job=<id> narrows that import to just the one capture the picker was shown
  // for -- without it, choosing a pack for a single just-finished capture would also sweep in
  // any other unrelated pending captures still queued, silently filing them into whichever
  // pack was clicked. Absent (e.g. a plain bookmarked/typed ?open= URL), the original
  // sweep-everything-pending behaviour still applies.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("open");
    if (!id) return;
    const jobId = params.get("job") ?? undefined;
    window.history.replaceState(null, "", window.location.pathname);
    void getProject(id).then((existing) => { if (existing) void open(existing, jobId); });
  }, []);

  // The "Send to Tracepack" embed contract: a third-party site opens this tab with
  // ?send-to-tracepack=1 and hands off a tracepack-evidence v1 payload via postMessage. See
  // externalImport.ts and templates/../EMBED_GUIDE.md. Kept as its own query param (not folded
  // into the ?open= case above) since there is no project id yet to open into -- the whole
  // point of this view is picking or creating one.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get("send-to-tracepack")) return;
    window.history.replaceState(null, "", window.location.pathname);
    setView("external-import");
  }, []);

  // Posts back to whichever tab opened this one, if any -- a same-page reload or someone just
  // visiting the URL directly has no opener, so this is always a no-op there, never an error.
  function notifyOpener(message: Record<string, unknown>) {
    if (window.opener) window.opener.postMessage(message, "*");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = createProject({
      title: String(data.get("title")),
      organisation: String(data.get("organisation")),
      summary: String(data.get("summary")),
      desiredResolution: String(data.get("resolution")),
      keyDate: String(data.get("keyDate")) || undefined,
      template: selectedTemplate,
    });
    try {
      let withCaptures = await importPendingCaptures(next);
      // Same idea as importPendingCaptures immediately above: evidence waiting from a
      // "Send to Tracepack" postMessage handoff gets folded in as soon as a project exists to
      // receive it, whether the user created a new pack or (see open() below) opened an
      // existing one.
      if (pendingExternalPayload) {
        const result = await importExternalEvidence(withCaptures, pendingExternalPayload);
        withCaptures = result.project;
        notifyOpener({ source: "tracepack", type: "imported", projectId: withCaptures.id, evidenceCount: result.evidenceCount });
        setPendingExternalPayload(undefined);
      }
      await saveProject(withCaptures);
      setProject(withCaptures); setView("workspace"); await refresh();
    } catch (error) { setAppError(describeStorageError(error)); }
  }

  async function persist(next: TracepackProject) {
    setProject(next); setSaveState("saving");
    try { await saveProject(next); setSaveState("saved"); setAppError(""); await refresh(); }
    catch (error) { setSaveState("failed"); setAppError(describeStorageError(error)); }
  }

  async function importFiles(files: FileList | null) {
    if (!files || !project) return;
    let next = project;
    setNotice("");
    for (const file of Array.from(files)) {
      try {
        const inspection = inspectFile(file);
        const category = next.template.categories.find((entry) => entry.acceptedTypes.includes(inspection.sourceType));
        if (!category) throw new Error("This template does not accept that evidence type.");
        let item: EvidenceItem = {
          id: crypto.randomUUID(), projectId: next.id, title: humanizeFilename(file.name),
          categoryId: category.id, sourceType: inspection.sourceType, originalFileName: file.name,
          importedAt: new Date().toISOString(), contentHash: await sha256(file), reviewStatus: "needs_review",
          notes: "", size: file.size, mimeType: file.type, textExtractionStatus: inspection.sourceType === "pdf" ? "pending" : undefined,
        };
        if (inspection.sourceType === "pdf") {
          try { const pdf = await inspectPdf(file, next.template.privacyRules); item = { ...item, pageCount: pdf.pageCount, extractedText: pdf.text, textExtractionStatus: pdf.textStatus, privacyFindings: pdf.findings }; }
          // The badge alone never explains why. Logged for anyone with devtools open (the
          // author included) since a worker load failure, a corrupt file, and a password-
          // protected PDF are all invisible from the UI otherwise.
          catch (error) { console.error(`PDF text extraction failed for "${file.name}":`, error); item = { ...item, textExtractionStatus: "failed" }; }
        }
        // A file's own name (and the title Tracepack derives from it) can carry PII just
        // as easily as the document body — scanned the same way, merged alongside any
        // body findings already on the item.
        item = { ...item, privacyFindings: rescanFieldFindings(item.title, item.originalFileName, item.privacyFindings ?? [], next.template.privacyRules) };
        await saveEvidenceFile(item.id, file);
        next = addEvidence(next, item);
      } catch (error) { setNotice(describeStorageError(error)); }
    }
    await persist(next);
    if (fileInput.current) fileInput.current.value = "";
  }

  // Some required categories (e.g. "Complaint details") only accept written notes, not
  // files or captures — without this, those categories could never be satisfied at all.
  async function addNote(categoryId: string, title: string, body: string) {
    if (!project) return;
    const text = body.trim();
    if (!text) return;
    setNotice("");
    try {
      const blob = new Blob([text], { type: "text/plain" });
      const noteTitle = title.trim() || "Note";
      // A hand-typed note's body goes into the exported PDF exactly like PDF page text does,
      // so it needs the same PII scan PDFs get. Without this, someone who types PII directly
      // into a note (instead of importing a file containing it) would never see a finding for
      // it, unlike every other evidence path.
      const bodyFindings = detectPrivacyFindings(text, "body", project.template.privacyRules);
      const item: EvidenceItem = {
        id: crypto.randomUUID(), projectId: project.id, title: noteTitle,
        categoryId, sourceType: "note", importedAt: new Date().toISOString(),
        contentHash: await sha256(blob), reviewStatus: "needs_review", notes: "",
        size: blob.size, mimeType: "text/plain", extractedText: text, textExtractionStatus: "complete",
        privacyFindings: rescanFieldFindings(noteTitle, undefined, bodyFindings, project.template.privacyRules),
      };
      await saveEvidenceFile(item.id, blob);
      await persist(addEvidence(project, item));
    } catch (error) { setNotice(describeStorageError(error)); }
  }

  async function remove(existing: TracepackProject) {
    if (!confirm(`Delete ${existing.title}? This removes its locally stored evidence.`)) return;
    try { await deleteProject(existing); setAppError(""); await refresh(); }
    catch (error) { setAppError(`"${existing.title}" was not fully deleted: ${describeStorageError(error)}`); await refresh(); }
  }

  async function open(existing: TracepackProject, onlyJobId?: string) {
    try {
      let withCaptures = await importPendingCaptures(existing, onlyJobId);
      if (pendingExternalPayload) {
        const result = await importExternalEvidence(withCaptures, pendingExternalPayload);
        withCaptures = result.project;
        notifyOpener({ source: "tracepack", type: "imported", projectId: withCaptures.id, evidenceCount: result.evidenceCount });
        setPendingExternalPayload(undefined);
      }
      if (withCaptures !== existing) await saveProject(withCaptures);
      setProject(withCaptures); setView("workspace"); await refresh();
    } catch (error) { setAppError(describeStorageError(error)); }
  }

  function finishOnboarding() {
    try { window.localStorage.setItem("tracepack-introduction-complete", "yes"); }
    catch { /* The workspace remains usable when browser preferences block local storage. */ }
    setShowOnboarding(false);
  }

  return <div className="app-shell">
    {showOnboarding && <Onboarding onFinish={finishOnboarding} />}
    <header className="topbar">
      <button className="brand" onClick={() => { setView("home"); setProject(undefined); }}><Mark />Tracepack</button>
      <span className="local-label">Local workspace</span>
      {project && <span className={`save-state ${saveState}`}>{saveState === "saved" ? "Saved locally" : saveState === "saving" ? "Saving" : "Save failed"}</span>}
      <button className="replay-intro" type="button" onClick={() => setShowOnboarding(true)}>Introduction</button>
    </header>
    {appError && <div className="page"><div className="alert" role="alert">{appError}</div></div>}
    <div ref={viewContent} tabIndex={-1} className="view-outlet">
      {view === "home" && <Home projects={projects} open={(item) => void open(item)} start={(template) => { setSelectedTemplate(template); setView("new"); }} buildOwn={() => setView("custom")} remove={remove} pendingCaptures={pendingCaptures} pendingExternal={!!pendingExternalPayload} recommendedTemplate={recommendedTemplate} recommendationReason={recommendationReason} />}
      {view === "new" && <NewProject template={selectedTemplate} seed={pendingExternalPayload ? seedFromExternalPayload(pendingExternalPayload) : undefined} onSubmit={create} cancel={() => setView("home")} />}
      {view === "custom" && <CustomTemplate onBuilt={(template) => { setSelectedTemplate(template); setView("new"); }} cancel={() => setView("home")} />}
      {view === "external-import" && <ExternalImport
        projects={projects}
        addToProject={async (target, payload) => {
          const result = await importExternalEvidence(target, payload);
          await saveProject(result.project);
          notifyOpener({ source: "tracepack", type: "imported", projectId: result.project.id, evidenceCount: result.evidenceCount });
          setProject(result.project); setView("workspace"); await refresh();
        }}
        startNewPack={(payload) => { setPendingExternalPayload(payload); setView("home"); }}
        back={() => setView("home")}
      />}
      {view === "workspace" && project && <Workspace project={project} notice={notice} importFiles={importFiles} addNote={addNote} fileInput={fileInput} update={persist} navigate={setView} />}
      {view === "privacy" && project && <PrivacyReview project={project} update={persist} back={() => setView("workspace")} />}
      {view === "timeline" && project && <TimelineReview project={project} update={persist} back={() => setView("workspace")} />}
      {view === "export" && project && <ExportPreview project={project} update={persist} navigate={setView} back={() => setView("workspace")} />}
    </div>
  </div>;
}

function Home({ projects, open, start, buildOwn, remove, pendingCaptures, pendingExternal, recommendedTemplate, recommendationReason }: { projects: TracepackProject[]; open: (p: TracepackProject) => void; start: (template: TemplateSnapshot) => void; buildOwn: () => void; remove: (p: TracepackProject) => void; pendingCaptures: number; pendingExternal: boolean; recommendedTemplate?: TemplateSnapshot; recommendationReason?: string }) {
  const defaultTemplate = templates[0]!;
  // A recommendation matching the default template is already covered by the primary button
  // below, so it only changes anything when it points somewhere else -- no need to duplicate
  // the same choice twice on screen.
  const recommendation = recommendedTemplate && recommendedTemplate.id !== defaultTemplate.id ? recommendedTemplate : undefined;
  const otherTemplates = templates.slice(1).filter((tpl) => tpl.id !== recommendation?.id);
  return <main className="page home">
    <section className="hero">
      <p className="eyebrow">Private by default</p>
      <h1>Build a clear evidence pack from scattered files.</h1>
      <p className="lede">Files, captures and external evidence become one traceable case, reviewed for privacy and organised by what it's for, without leaving your device.</p>
      {recommendation && <div className="template-recommend">
        <span className="recommend-tag">Suggested from the evidence</span>
        <p className="recommend-name">{recommendation.name}</p>
        {/* Not "RECOMMENDED FOR THIS CONVERSATION", Tracepack can receive evidence from a
            capture or a producer payload, not only a support conversation, and the whole point
            of stating a reason is to be specific, not to overclaim what was actually detected. */}
        <p>{recommendationReason ? `The imported material contains ${recommendationReason}.` : "Matches what was imported."} You can choose another structure below.</p>
      </div>}
      <div className="actions">
        <button className="btn btn-primary" type="button" onClick={() => start(recommendation ?? defaultTemplate)}>{recommendation ? `Start a ${recommendation.name} pack` : "Create a pack"}</button>
        <div className="template-picker">
          <span>or start from</span>
          {recommendation && <button type="button" className="btn btn-quiet" onClick={() => start(defaultTemplate)}>{defaultTemplate.name}</button>}
          {otherTemplates.map((tpl) => <button key={tpl.id} type="button" className="btn btn-quiet" onClick={() => start(tpl)}>{tpl.name}</button>)}
          <button type="button" className="btn btn-quiet" onClick={buildOwn}>your own structure</button>
        </div>
      </div>
    </section>

    <div className="flow" aria-hidden="true">
      <svg viewBox="0 0 610 350">
        <line className="thread t1" x1="162" y1="54" x2="246" y2="118" stroke="#8a9a8f" strokeWidth="1.5" />
        <line className="thread t2" x1="150" y1="192" x2="252" y2="180" stroke="#8a9a8f" strokeWidth="1.5" />
        <line className="thread t3" x1="440" y1="192" x2="328" y2="180" stroke="#8a9a8f" strokeWidth="1.5" />

        <g transform="translate(50,16)"><g className="node-doc d1">
          <rect width="112" height="76" rx="8" fill="var(--paper)" stroke="#b9c2b9" />
          <rect x="14" y="16" width="60" height="6" rx="3" fill="#d9ddd6" />
          <rect x="14" y="30" width="84" height="6" rx="3" fill="#d9ddd6" />
          <rect x="14" y="44" width="70" height="6" rx="3" fill="#d9ddd6" />
          <text x="14" y="66" fontSize="10" fontWeight="800" fill="#5c6b62" fontFamily="Inter, sans-serif">PDF</text>
        </g></g>

        <g transform="translate(38,176)"><g className="node-doc d2">
          <rect width="112" height="76" rx="8" fill="var(--paper)" stroke="#b9c2b9" />
          <rect x="12" y="12" width="88" height="42" rx="5" fill="#e3e8e2" />
          <text x="12" y="68" fontSize="10" fontWeight="800" fill="#5c6b62" fontFamily="Inter, sans-serif">SCREENSHOT</text>
        </g></g>

        <g transform="translate(440,176)"><g className="node-doc d3">
          <rect width="112" height="76" rx="8" fill="var(--paper)" stroke="#b9c2b9" />
          <circle cx="26" cy="26" r="9" fill="#d5f66b" stroke="#1d3c2d" />
          <rect x="44" y="20" width="52" height="6" rx="3" fill="#d9ddd6" />
          <rect x="44" y="32" width="40" height="6" rx="3" fill="#d9ddd6" />
          <text x="12" y="66" fontSize="9.5" fontWeight="800" fill="#5c6b62" fontFamily="Inter, sans-serif">EXTERNAL TOOL</text>
        </g></g>

        <g transform="translate(236,92)"><g className="mark-wrap">
          <rect width="108" height="108" rx="18" fill="#1d3c2d" />
          <path d="M38 20 H70 A10 10 0 0 1 80 30 V78 A10 10 0 0 1 70 88 H38 A10 10 0 0 1 28 78 V30 A10 10 0 0 1 38 20 Z" fill="#d5f66b" transform="translate(0,-2) scale(0.86) translate(9,10)" />
          <path d="M45 46 A9 9 0 1 1 63 46 A9 9 0 1 1 45 46 Z" fill="#1d3c2d" transform="translate(0,-2) scale(0.86) translate(9,10)" />
          <path d="M53 52 H55 A3 3 0 0 1 58 55 V67 A3 3 0 0 1 55 70 H53 A3 3 0 0 1 50 67 V55 A3 3 0 0 1 53 52 Z" fill="#1d3c2d" transform="translate(0,-2) scale(0.86) translate(9,10)" />
        </g></g>

        <line className="stage-line" x1="290" y1="200" x2="290" y2="296" stroke="#8a9a8f" strokeWidth="1.5" />
        <g className="stage-stop st1" transform="translate(290,220)">
          <circle r="4.5" fill="var(--accent-dark)" />
          <text x="14" y="4" fontSize="13" fontWeight="700" fill="var(--ink)" fontFamily="Inter, sans-serif">Privacy reviewed</text>
        </g>
        <g className="stage-stop st2" transform="translate(290,252)">
          <circle r="4.5" fill="var(--accent-dark)" />
          <text x="14" y="4" fontSize="13" fontWeight="700" fill="var(--ink)" fontFamily="Inter, sans-serif">Organised</text>
        </g>
        <g className="stage-stop st3" transform="translate(290,284)">
          <circle r="5.5" fill="var(--accent)" stroke="var(--accent-dark)" strokeWidth="1.5" />
          <text x="16" y="4.5" fontSize="14" fontWeight="800" fill="var(--ink)" fontFamily="Inter, sans-serif">Pack</text>
        </g>
      </svg>
    </div>

    {pendingCaptures > 0 && <div className="alert" role="status"><strong>{pendingCaptures} page{pendingCaptures === 1 ? "" : "s"} captured and waiting.</strong> Start or open a pack below to add {pendingCaptures === 1 ? "it" : "them"} as evidence.</div>}
    {pendingExternal && <div className="alert" role="status"><strong>External evidence waiting.</strong> Start or open a pack below to add it.</div>}

    {projects.length === 0 ? <div className="empty-panel">
      <svg viewBox="0 0 108 108" fill="none">
        <path d="M18 40 L54 24 L90 40 V82 A6 6 0 0 1 84 88 H24 A6 6 0 0 1 18 82 Z" fill="var(--ground)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <path d="M18 40 L54 56 L90 40" stroke="var(--line-strong)" strokeWidth="1.5" fill="none" />
        <path d="M42 62 H66" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" />
        <circle cx="54" cy="24" r="5" fill="var(--accent)" stroke="var(--accent-dark)" />
      </svg>
      <div>
        <h2>No packs yet</h2>
        <p className="sub">Local storage is not a backup: clearing browser data can remove packs. Start with a template, or bring in evidence you already have.</p>
        <div className="empty-actions">
          {templates.map((tpl, i) => <button key={tpl.id} type="button" onClick={() => start(tpl)}><span className="chip">{i + 1}</span>{templates.length > 1 ? tpl.name : "Start from a template"}</button>)}
          <button type="button" onClick={buildOwn}><span className="chip">{templates.length + 1}</span>Build your own structure</button>
          <button type="button" onClick={() => start(defaultTemplate)}><span className="chip">{templates.length + 2}</span>Bring in evidence you already have</button>
        </div>
      </div>
    </div> : <section aria-labelledby="recent">
      <div className="section-heading"><div><p className="eyebrow">On this device</p><h2 id="recent">Recent packs</h2></div><span>{projects.length} {projects.length === 1 ? "pack" : "packs"}</span></div>
      <div className="pack-grid">{projects.map((item) => <article className="card-tile" key={item.id}>
        <div><span className="status">{item.template.name}</span><h3>{item.title}</h3><p>{item.evidence.length} evidence items · Updated {new Date(item.updatedAt).toLocaleDateString()}</p></div>
        <div className="actions"><button className="btn btn-secondary" onClick={() => open(item)} aria-label={`Open ${item.title}`}>Open</button><button className="btn btn-quiet danger" onClick={() => remove(item)} aria-label={`Delete ${item.title}`}>Delete</button></div>
      </article>)}</div>
    </section>}
  </main>;
}

// The receiving half of the "Send to Tracepack" embed contract (see externalImport.ts). A
// third-party site opens this tab with ?send-to-tracepack=1 and posts a tracepack-evidence v1
// payload once this component signals it's ready. Everything from here on reuses the same
// importEvidencePayload pipeline a producer's own server-side import would, including the same
// hash verification and PII scan -- this view is just a different front door onto it.
function ExternalImport({ projects, addToProject, startNewPack, back }: {
  projects: TracepackProject[];
  addToProject: (target: TracepackProject, payload: TracepackEvidencePayloadV1) => Promise<void>;
  startNewPack: (payload: TracepackEvidencePayloadV1) => void;
  back: () => void;
}) {
  const [payload, setPayload] = useState<TracepackEvidencePayloadV1>();
  const [issues, setIssues] = useState<string[]>();
  const [manualJson, setManualJson] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isEvidenceMessage(event.data)) return; // not meant for us -- ignore, not an error
      const result = checkIncomingEvidence(event.data);
      if (result.ok) { setPayload(result.payload); setIssues(undefined); }
      else setIssues(result.issues.map((issue) => `${issue.path || "root"}: ${issue.message}`));
    }
    window.addEventListener("message", handleMessage);
    if (window.opener) window.opener.postMessage(READY_MESSAGE, "*");
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  function checkJsonText(text: string) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { setIssues(["That isn't valid JSON."]); return; }
    const result = checkIncomingEvidence({ source: "tracepack-producer", type: "evidence", payload: parsed });
    if (result.ok) { setPayload(result.payload); setIssues(undefined); }
    else setIssues(result.issues.map((issue) => `${issue.path || "root"}: ${issue.message}`));
  }

  // Pairs with the embed button's "extension not installed" fallback (EMBED_GUIDE.md): a site
  // that can't reach an installed Tracepack extension offers a downloaded .json file instead --
  // this is where that file lands.
  function handleFileUpload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => checkJsonText(String(reader.result ?? ""));
    reader.onerror = () => setIssues(["That file could not be read."]);
    reader.readAsText(file);
  }

  async function confirmAdd() {
    const target = projects.find((entry) => entry.id === selectedProjectId);
    if (!payload || !target) return;
    setBusy(true); setError("");
    try { await addToProject(target, payload); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "That evidence could not be added."); setBusy(false); }
  }

  return <main className="page narrow">
    <button className="back-link" onClick={back}>&larr; Back to home</button>
    <p className="eyebrow">Send to Tracepack</p>
    <h1>External evidence</h1>

    {!payload && <>
      <p className="lede">Waiting for evidence from the site that opened this tab. Nothing has been imported yet -- this page only accepts a payload once you (or the site) actually send one.</p>
      {issues && <div className="alert" role="alert"><strong>That evidence couldn't be read.</strong><ul>{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div>}
      <details className="manual-import">
        <summary>Or add the evidence file yourself</summary>
        <label className="file-upload-row">Upload a downloaded evidence file
          <input type="file" accept="application/json,.json" onChange={(e) => handleFileUpload(e.target.files)} />
        </label>
        <p className="or-divider">or paste it</p>
        <textarea rows={8} value={manualJson} onChange={(e) => setManualJson(e.target.value)} placeholder="Paste a tracepack-evidence v1 JSON payload" />
        <button type="button" className="btn btn-secondary" onClick={() => checkJsonText(manualJson)}>Check payload</button>
      </details>
    </>}

    {payload && <div className="external-review">
      <div className="review-summary">
        <p><strong>{payload.source.producer_name}</strong> wants to add evidence to a pack.</p>
        <p className="sub">{payload.evidence_type.replace(/_/g, " ")} &middot; {payload.attachments.length} attachment{payload.attachments.length === 1 ? "" : "s"} &middot; {payload.observations.length} observation{payload.observations.length === 1 ? "" : "s"}</p>
        <p className="sub">Nothing is Tracepack-verified yet: producer identity is self-asserted, and any PDF attachment still goes through the same privacy scan a manual upload gets, before you can export.</p>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      {projects.length > 0 && <div className="form">
        <label>Add to an existing pack
          <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            <option value="">Choose a pack&hellip;</option>
            {projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-primary" disabled={!selectedProjectId || busy} onClick={() => void confirmAdd()}>{busy ? "Adding..." : "Add to this pack"}</button>
      </div>}
      <button type="button" className="btn btn-quiet" onClick={() => startNewPack(payload)}>or start a new pack with this evidence</button>
    </div>}
  </main>;
}

const CUSTOM_TYPE_OPTIONS: SourceType[] = ["pdf", "image", "note", "webpage"];
interface CustomRow { name: string; requirement: Requirement; types: SourceType[] }
const blankCustomRow = (): CustomRow => ({ name: "", requirement: "recommended", types: ["pdf", "image"] });

// The point of this screen: a template that exists nowhere in this codebase until a user
// types it. It goes through parseTemplateObject -- the exact same zod schema loadTemplate
// uses for the YAML files in templates/ -- so a hand-built structure is validated exactly as
// strictly as a shipped one, not through a separate, looser path.
function CustomTemplate({ onBuilt, cancel }: { onBuilt: (template: TemplateSnapshot) => void; cancel: () => void }) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState<CustomRow[]>([blankCustomRow()]);
  const [error, setError] = useState("");

  function updateRow(index: number, patch: Partial<CustomRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function toggleType(index: number, type: SourceType) {
    setRows((current) => current.map((row, i) => i === index ? { ...row, types: row.types.includes(type) ? row.types.filter((t) => t !== type) : [...row.types, type] } : row));
  }

  function build(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const templateName = name.trim();
    if (!templateName) { setError("Give this template a name."); return; }
    const cleanRows = rows.filter((row) => row.name.trim());
    if (cleanRows.length === 0) { setError("Add at least one category."); return; }
    const noTypes = cleanRows.find((row) => row.types.length === 0);
    if (noTypes) { setError(`"${noTypes.name.trim()}" needs at least one accepted file type.`); return; }
    const usedIds = new Set<string>();
    const categories = cleanRows.map((row, i) => {
      const base = row.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || `category-${i}`;
      let id = base;
      while (usedIds.has(id)) id = `${base}-${i}`;
      usedIds.add(id);
      return { id, name: row.name.trim(), requirement: row.requirement, description: "", accepted_types: row.types };
    });
    const slug = templateName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || "custom";
    try {
      onBuilt(parseTemplateObject({
        id: `custom-${slug}-${Date.now().toString(36)}`,
        name: templateName,
        version: "0.1.0",
        jurisdiction: "general",
        categories,
        export_sections: ["cover", "evidence_checklist", "timeline", "evidence_index", "evidence_documents", "source_manifest"],
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That template could not be built.");
    }
  }

  return <main className="page narrow">
    <button className="back-link" onClick={cancel}>&larr; Back to home</button>
    <p className="eyebrow">Custom template</p>
    <h1>Build your own structure</h1>
    <p className="lede">Name each category you want to track. Tracepack sorts evidence, tracks gaps and builds the export from this the same way it does for any built-in template.</p>
    <form className="form custom-template-form" onSubmit={build}>
      <label>Template name <span>Required</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home renovation record" /></label>
      <div className="category-rows">
        {rows.map((row, i) => <div className="category-row" key={i}>
          <input value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="Category name, e.g. Permits" aria-label={`Category ${i + 1} name`} />
          <select value={row.requirement} onChange={(e) => updateRow(i, { requirement: e.target.value as Requirement })} aria-label={`Category ${i + 1} requirement`}>
            <option value="required">Required</option>
            <option value="recommended">Recommended</option>
            <option value="optional">Optional</option>
          </select>
          <div className="type-toggles">
            {CUSTOM_TYPE_OPTIONS.map((type) => <label key={type} className={row.types.includes(type) ? "is-on" : ""}>
              <input type="checkbox" checked={row.types.includes(type)} onChange={() => toggleType(i, type)} />{type}
            </label>)}
          </div>
          <button type="button" className="btn-quiet danger" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, idx) => idx !== i))}>Remove</button>
        </div>)}
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => setRows((current) => [...current, blankCustomRow()])}>Add another category</button>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="actions"><button className="btn btn-primary">Continue</button><button type="button" className="btn btn-secondary" onClick={cancel}>Cancel</button></div>
    </form>
  </main>;
}

function NewProject({ template, seed, onSubmit, cancel }: { template: TemplateSnapshot; seed?: { title?: string; summary?: string }; onSubmit: (e: FormEvent<HTMLFormElement>) => void; cancel: () => void }) {
  return <main className="page narrow">
    <button className="back-link" onClick={cancel}>&larr; Back to home</button>
    <p className="eyebrow">{template.name} template</p>
    <h1>Start with the basics</h1>
    <p className="lede">{seed ? "Filled in from the evidence you're adding. Change anything before creating the pack." : "You only need a pack title now. Everything else can be completed later."}</p>
    <form className="form" onSubmit={onSubmit}>
      <label>Pack title <span>Required</span><input name="title" required placeholder="Faulty kettle complaint" defaultValue={seed?.title ?? ""} /></label>
      <label>Seller or organisation<input name="organisation" placeholder="Example Retail Ltd" /></label>
      <label>{template.summaryLabel ?? "What happened"}<textarea name="summary" rows={4} placeholder={template.summaryPlaceholder ?? "Describe the purchase, problem and contact so far."} defaultValue={seed?.summary ?? ""} /></label>
      <label>{template.resolutionLabel ?? "Desired resolution"}<input name="resolution" placeholder={template.resolutionPlaceholder ?? "Refund, replacement or another outcome"} /></label>
      <label>Key date<input name="keyDate" type="date" /></label>
      <div className="actions"><button className="btn btn-primary">Create pack</button><button type="button" className="btn btn-secondary" onClick={cancel}>Cancel</button></div>
    </form>
  </main>;
}

// Consolidates signals that already exist scattered across the workspace, privacy review, and
// export preview pages (evidence count, unresolved findings, required-category progress) plus
// two that don't have a surface anywhere yet (provenance, a computed export-readiness label)
// into one at-a-glance panel. Additive next to the existing progress-panel, not a replacement.
function PackOverview({ project }: { project: TracepackProject }) {
  const activeEvidence = project.evidence.filter((item) => item.reviewStatus !== "excluded");
  const findings = activeEvidence.flatMap((item) => item.privacyFindings ?? []);
  const unresolvedFindings = findings.filter((finding) => finding.decision === "unreviewed").length;
  const reviewedFindings = findings.length - unresolvedFindings;
  const datedItems = activeEvidence.filter((item) => item.eventDate).length;
  const chronologyGaps = getChronologyGaps(project).length;
  const required = getRequiredSummary(project);
  const missingRequired = required.total - required.complete;
  const producers = new Set(
    activeEvidence.map((item) => item.provenance?.producerId).filter((id): id is string => !!id),
  );
  const needsAttention = unresolvedFindings > 0 || missingRequired > 0;

  return <section className="pack-overview" aria-label="Pack overview">
    <div className="overview-tile"><span className="overview-label">Evidence</span><strong>{activeEvidence.length}</strong><span className="overview-detail">item{activeEvidence.length === 1 ? "" : "s"}</span></div>
    <div className="overview-tile"><span className="overview-label">Chronology</span><strong>{datedItems}</strong><span className="overview-detail">{chronologyGaps > 0 ? `${chronologyGaps} gap${chronologyGaps === 1 ? "" : "s"} flagged` : "dated item" + (datedItems === 1 ? "" : "s")}</span></div>
    <div className="overview-tile"><span className="overview-label">Privacy</span><strong>{reviewedFindings}</strong><span className="overview-detail">{unresolvedFindings > 0 ? `${unresolvedFindings} unresolved` : "reviewed"}</span></div>
    <div className="overview-tile"><span className="overview-label">Requirements</span><strong>{missingRequired}</strong><span className="overview-detail">{missingRequired === 0 ? "all set" : "missing"}</span></div>
    <div className="overview-tile"><span className="overview-label">Provenance</span><strong>{producers.size}</strong><span className="overview-detail">external producer{producers.size === 1 ? "" : "s"}</span></div>
    <div className={`overview-tile overview-readiness ${needsAttention ? "needs-attention" : "ready"}`}><span className="overview-label">Export readiness</span><strong>{needsAttention ? "Needs attention" : "Ready"}</strong><span className="overview-detail">against this pack's own template, not a legal opinion</span></div>
  </section>;
}

function Workspace({ project, notice, importFiles, addNote, fileInput, update, navigate }: { project: TracepackProject; notice: string; importFiles: (f: FileList | null) => void; addNote: (categoryId: string, title: string, body: string) => void; fileInput: React.RefObject<HTMLInputElement | null>; update: (p: TracepackProject) => void; navigate: (v: View) => void }) {
  const progress = getCategoryProgress(project); const summary = getRequiredSummary(project);
  const [addingNote, setAddingNote] = useState(false);
  const noteCategories = project.template.categories.filter((category) => category.acceptedTypes.includes("note"));
  // Title is edited freely in EvidenceCard's inline input — without re-scanning here, a
  // title edited after import could introduce (or remove) PII that the review queue and
  // final export sweep would never see.
  function patchItem(id: string, patch: Partial<EvidenceItem>) {
    void update({
      ...project,
      evidence: project.evidence.map((item) => {
        if (item.id !== id) return item;
        const merged = { ...item, ...patch };
        if (patch.title === undefined) return merged;
        return { ...merged, privacyFindings: rescanFieldFindings(merged.title, merged.originalFileName, merged.privacyFindings ?? [], project.template.privacyRules) };
      }),
      updatedAt: new Date().toISOString(),
    });
  }
  const findingCount = project.evidence.flatMap((item) => item.privacyFindings ?? []).filter((finding) => finding.decision === "unreviewed").length;
  return <main className="page workspace">
    <div className="workspace-title"><div><p className="eyebrow">{project.template.name}</p><h1>{project.title}</h1><p>{project.organisation || "No organisation added"}</p></div>
      <div className="actions"><button className="btn btn-secondary" onClick={() => navigate("privacy")}>Privacy review {findingCount ? `(${findingCount})` : ""}</button><button className="btn btn-secondary" onClick={() => navigate("timeline")}>Timeline</button><button className="btn btn-primary" onClick={() => navigate("export")}>Preview export</button></div>
    </div>
    <PackOverview project={project} />
    <section className="progress-panel"><div><strong>{summary.total === 0 ? "This template has no required categories" : `${summary.complete} of ${summary.total} required categories complete`}</strong><p>Tracepack explains gaps using categories and reasons, not a mystery score.</p></div>{summary.total > 0 && <div className="segments" role="progressbar" aria-label="Required categories complete" aria-valuenow={summary.complete} aria-valuemin={0} aria-valuemax={summary.total} aria-valuetext={`${summary.complete} of ${summary.total} required categories complete`}>{Array.from({ length: summary.total }, (_, i) => <span key={i} aria-hidden="true" className={i < summary.complete ? "filled" : ""} />)}</div>}</section>
    {notice && <div className="alert" role="alert">{notice}</div>}
    <div className="workspace-grid">
      <section><div className="section-heading"><div><p className="eyebrow">Your material</p><h2>Evidence</h2></div>
        <div className="actions"><label className="btn btn-primary file-button">Add PDF or image<input ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple onChange={(e) => void importFiles(e.target.files)} /></label>{noteCategories.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => setAddingNote((value) => !value)} aria-expanded={addingNote}>{addingNote ? "Close note" : "Add a note"}</button>}</div></div>
        {addingNote && <NoteForm categories={noteCategories} onAdd={(categoryId, title, body) => { addNote(categoryId, title, body); setAddingNote(false); }} onCancel={() => setAddingNote(false)} />}
        {project.evidence.length === 0 ? <div className="empty"><h3>Add your first evidence item</h3><p>PDF, JPG, PNG and WebP files are supported. Some categories accept a written note instead.</p></div> : <div className="evidence-list">{project.evidence.map((item, index) => <EvidenceCard key={item.id} item={item} index={index} project={project} patch={patchItem} />)}</div>}
      </section>
      <aside><p className="eyebrow">Template checklist</p><h2>What is covered</h2><div className="checklist">{progress.map(({ category, complete, itemCount }) => { const minItems = category.minItems ?? 1; const status = complete ? `${itemCount} item${itemCount === 1 ? "" : "s"} added` : itemCount > 0 ? `${itemCount} of ${minItems} items added` : category.description; const guidance = project.template.guidance?.find((entry) => entry.categoryId === category.id); return <div className="check-row" key={category.id}><span className={complete ? "check complete" : "check"} aria-hidden="true">{complete ? "✓" : "!"}</span><div><strong>{category.name}</strong><p>{status}</p><small>{category.requirement}</small>{guidance && <p className="guidance-tip">{guidance.text}</p>}</div></div>; })}</div></aside>
    </div>
  </main>;
}

function NoteForm({ categories, onAdd, onCancel }: { categories: EvidenceCategory[]; onAdd: (categoryId: string, title: string, body: string) => void; onCancel: () => void }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    onAdd(categoryId, title, body);
  }
  return <form className="form note-form" onSubmit={submit}>
    <label>Category<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kettle stopped heating" /></label>
    <label>Note<textarea rows={5} required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe it in your own words. This becomes a page in the exported pack." /></label>
    <div className="actions"><button className="btn btn-primary" type="submit">Add note</button><button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function EvidenceCard({ item, index, project, patch }: { item: EvidenceItem; index: number; project: TracepackProject; patch: (id: string, patch: Partial<EvidenceItem>) => void }) {
  const [preview, setPreview] = useState(false); const [url, setUrl] = useState(""); const canvas = useRef<HTMLCanvasElement>(null);
  // A note's content already lives on the item itself (extractedText), there is no
  // separate file to fetch or render, so previewing one never touches storage.
  useEffect(() => { if (!preview || item.sourceType === "note") return; let active = true; let objectUrl = ""; void getEvidenceFile(item.id).then(async (stored) => { if (!stored || !active) return; if (item.sourceType === "pdf" && canvas.current) await renderPdfPage(stored.blob, canvas.current); else { objectUrl = URL.createObjectURL(stored.blob); setUrl(objectUrl); } }); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [preview, item.id, item.sourceType]);
  const typeLabel = item.sourceType === "pdf" ? "PDF" : item.sourceType === "note" ? "Note" : item.sourceType === "webpage" ? "Capture" : "Image";
  return <article className="evidence-card">
    <span className="num">{String(index + 1).padStart(2, "0")}</span>
    <div className="evidence-main">
      <input aria-label="Evidence title" className="inline-title" value={item.title} onChange={(e) => patch(item.id, { title: e.target.value })} />
      <p><span className="warning-pill" style={{ background: "var(--ground)", color: "var(--muted)" }}>{typeLabel}</span> {item.sourceType === "note" ? "Written note" : item.originalFileName} &middot; {(item.size / 1024).toFixed(0)} KB {item.pageCount ? `· ${item.pageCount} pages` : ""}</p>
      <code title={item.contentHash}>SHA-256 {item.contentHash.slice(0, 12)}&hellip;</code>
      <div><button className="btn-quiet" aria-expanded={preview} aria-controls={`preview-${item.id}`} onClick={() => setPreview(!preview)}>{preview ? "Close preview" : "Preview"}</button>{item.textExtractionStatus === "no_text_layer" && <span className="warning-pill">No text layer</span>}{item.textExtractionStatus === "failed" && <span className="warning-pill">Text extraction failed</span>}</div>
      {preview && <div className="document-preview" id={`preview-${item.id}`}>{item.sourceType === "pdf" ? <canvas ref={canvas} role="img" aria-label={`Preview of ${item.title}, page 1`} /> : item.sourceType === "note" ? <p style={{ whiteSpace: "pre-wrap" }}>{item.extractedText}</p> : <img src={url} alt={`Preview of ${item.title}`} />}{item.extractedText && item.sourceType !== "note" && <details><summary>Extracted text</summary><p>{item.extractedText.slice(0, 3000)}</p></details>}</div>}
    </div>
    <div className="evidence-controls">
      <label>Category<select value={item.categoryId} onChange={(e) => patch(item.id, { categoryId: e.target.value })}>{project.template.categories.filter((category) => category.acceptedTypes.includes(item.sourceType)).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Event date<input type="date" value={item.eventDate ?? ""} onChange={(e) => patch(item.id, { eventDate: e.target.value || undefined })} /></label>
      <label>Status<select value={item.reviewStatus} onChange={(e) => patch(item.id, { reviewStatus: e.target.value as EvidenceItem["reviewStatus"] })}><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option><option value="excluded">Excluded</option></select></label>
    </div>
  </article>;
}

function PrivacyReview({ project, update, back }: { project: TracepackProject; update: (p: TracepackProject) => void; back: () => void }) {
  const findings = project.evidence.flatMap((item) => (item.privacyFindings ?? []).map((finding) => ({ item, finding })));
  // "image" and "webpage" items are never content-scanned (no OCR, only PDF text and typed/title
  // text). Surfaced unconditionally here, not only inside the findings.length === 0 empty state,
  // so a clean-looking pack with one scanned PDF can't hide an unscanned screenshot full of PII.
  const unscannedItems = project.evidence.filter((item) => item.reviewStatus !== "excluded" && (item.sourceType === "image" || item.sourceType === "webpage"));
  function decide(itemId: string, findingId: string, decision: PrivacyFinding["decision"]) { void update({ ...project, updatedAt: new Date().toISOString(), evidence: project.evidence.map((item) => item.id !== itemId ? item : { ...item, privacyFindings: (item.privacyFindings ?? []).map((finding) => finding.id === findingId ? { ...finding, decision } : finding) }) }); }
  return <main className="page narrow">
    <button className="back-link" onClick={back}>&larr; Back to workspace</button>
    <p className="eyebrow">Human review required</p><h1>Privacy review</h1>
    <p className="lede">Tracepack flags patterns in extracted PDF text, evidence titles and filenames. A match is not automatically removed and may be a false positive.</p>
    {unscannedItems.length > 0 && <div className="alert" role="alert" style={{ marginTop: 20 }}>
      <strong>{unscannedItems.length} item{unscannedItems.length === 1 ? "" : "s"} not scanned for content.</strong>
      <p>Tracepack cannot read text inside an image or a screenshot, there is no OCR built in. Look at {unscannedItems.length === 1 ? "it" : "each of these"} yourself before exporting: {unscannedItems.map((item) => item.title).join(", ")}.</p>
    </div>}
    {findings.length === 0 ? <div className="empty" style={{ marginTop: 30 }}><h3>No patterns detected in scanned text</h3><p>Extracted PDF text, evidence titles and filenames were checked; nothing matched.</p></div> : <div className="finding-list">{findings.map(({ item, finding }) => { const isBody = (finding.field ?? "body") === "body"; const removable = !isBody || !!finding.location; const foundIn = finding.field === "title" ? "title" : finding.field === "filename" ? "filename" : finding.location ? `page ${finding.location.pageNumber}` : undefined; return <article className="finding-card" key={`${item.id}-${finding.id}`}><div><span className="warning-pill">{finding.label}</span><h3>{finding.value}</h3><p>{finding.excerpt}</p><small>Found in {item.title}{foundIn ? `, ${foundIn}` : ""}</small></div><div className="actions"><button className={finding.decision === "keep" ? "btn btn-primary" : "btn btn-secondary"} onClick={() => decide(item.id, finding.id, "keep")}>Keep</button><button className={finding.decision === "remove" ? "btn btn-primary" : "btn btn-secondary"} disabled={!removable} title={!removable ? "Re-import this PDF to create a redaction location." : undefined} onClick={() => decide(item.id, finding.id, "remove")}>Mark for removal</button></div></article>; })}</div>}
    <div className="alert" style={{ marginTop: 30 }}><strong>Originals stay unchanged.</strong> Marked findings with page locations are irreversibly flattened in the exported PDF; marked title/filename findings have the matched text replaced wherever they are shown in an export. Older body findings without locations must be re-imported before they can be removed safely.</div>
  </main>;
}

function TimelineReview({ project, update, back }: { project: TracepackProject; update: (p: TracepackProject) => void; back: () => void }) {
  const ordered = [...project.evidence].filter((item) => item.reviewStatus !== "excluded").sort((a, b) => (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999"));
  // Real interval reasoning (getChronologyGaps), not just this list's own date sort -- only
  // produces anything when the active template opted into a continuity requirement.
  const gaps = getChronologyGaps(project);
  const gapAfterItemId = new Map(gaps.map((gap) => [gap.fromItemId, gap]));
  function date(id: string, eventDate: string) { void update({ ...project, updatedAt: new Date().toISOString(), evidence: project.evidence.map((item) => item.id === id ? { ...item, eventDate: eventDate || undefined } : item) }); }
  return <main className="page narrow">
    <button className="back-link" onClick={back}>&larr; Back to workspace</button>
    <p className="eyebrow">Chronology</p><h1>Timeline review</h1>
    <p className="lede">Add dates you can support from the evidence. Tracepack does not invent dates from incomplete text.</p>
    {gaps.length > 0 && <div className="alert" role="alert">
      <strong>{gaps.length} chronology gap{gaps.length === 1 ? "" : "s"} found.</strong>
      <p>This template expects continuous dated evidence, with nothing more than {project.template.chronologyRules?.maxGapDays} days between entries. Marked below.</p>
    </div>}
    <div className="timeline">{ordered.flatMap((item) => {
      const gap = gapAfterItemId.get(item.id);
      const row = <article key={item.id}><label><span>Event date</span><input type="date" value={item.eventDate ?? ""} onChange={(e) => date(item.id, e.target.value)} /></label><div><h3>{item.title}</h3><p>{project.template.categories.find((category) => category.id === item.categoryId)?.name}</p></div></article>;
      if (!gap) return [row];
      return [row, <div className="chronology-gap" key={`${item.id}-gap`} role="note"><span className="dot" aria-hidden="true" />{gap.days}-day gap before &ldquo;{gap.toTitle}&rdquo;</div>];
    })}</div>
  </main>;
}

type ExportPhase = "idle" | "assembling" | "success";

function ExportPreview({ project, update, back, navigate }: { project: TracepackProject; update: (p: TracepackProject) => Promise<void>; back: () => void; navigate: (v: View) => void }) {
  const progress = getCategoryProgress(project); const missing = progress.filter((entry) => !entry.complete && entry.category.requirement !== "optional");
  const required = missing.filter((entry) => entry.category.requirement === "required").length;
  const recommended = missing.filter((entry) => entry.category.requirement === "recommended").length;
  const included = project.evidence.filter((item) => item.reviewStatus !== "excluded");
  const unresolved = project.evidence.flatMap((item) => item.privacyFindings ?? []).filter((finding) => finding.decision === "unreviewed").length;
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [error, setError] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [savingBundle, setSavingBundle] = useState(false);
  const [otherBusy, setOtherBusy] = useState<"pdf" | "tracepack" | "epack" | "json" | null>(null);
  const exportResult = useRef<{ pdfUrl: string; swept: TracepackProject; files: Map<string, Blob> } | null>(null);

  useEffect(() => () => { if (exportResult.current) URL.revokeObjectURL(exportResult.current.pdfUrl); }, []);

  // The final gate before anything leaves the browser: re-scan title/filename fresh (in
  // case a title was edited, or this item predates title/filename scanning existing at
  // all) and refuse to build a pack while any finding — body, title or filename — is still
  // unreviewed. rescanFieldFindings never reverts an already-made decision, so this never
  // asks the user to re-decide something they already resolved. Shared by every export
  // format so a future format can never accidentally skip this gate — there is exactly one
  // place this check happens, not one copy per download button.
  async function prepareForExport(): Promise<{ swept: TracepackProject; files: Map<string, Blob> } | null> {
    const swept: TracepackProject = { ...project, evidence: project.evidence.map((item) => item.reviewStatus === "excluded" ? item : { ...item, privacyFindings: rescanFieldFindings(item.title, item.originalFileName, item.privacyFindings ?? [], project.template.privacyRules) }) };
    const sweptFindingsChanged = JSON.stringify(swept.evidence) !== JSON.stringify(project.evidence);
    if (sweptFindingsChanged) await update({ ...swept, updatedAt: new Date().toISOString() });
    const stillUnresolved = included.flatMap((item) => swept.evidence.find((entry) => entry.id === item.id)?.privacyFindings ?? []).filter((finding) => finding.decision === "unreviewed").length;
    if (stillUnresolved > 0) {
      setError(`${stillUnresolved} privacy finding${stillUnresolved === 1 ? "" : "s"} must be reviewed before this pack can be downloaded.`);
      return null;
    }
    const files = new Map<string, Blob>();
    for (const item of included) { const stored = await getEvidenceFile(item.id); if (stored) files.set(item.id, stored.blob); }
    return { swept, files };
  }

  // Shows the assembling animation for a minimum duration even if the real build finishes
  // faster, so the moment is watchable rather than a blink -- but never longer than the real
  // work takes, since transitions to "success" wait on both finishing, not just the timer.
  async function runPrimaryExport() {
    setError("");
    const prepared = await prepareForExport();
    if (!prepared) return;
    setPhase("assembling");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minDelay = new Promise<void>((resolve) => setTimeout(resolve, reduced ? 700 : 4700));
    try {
      const [pdfBlob] = await Promise.all([buildEvidencePack(prepared.swept, prepared.files), minDelay]);
      if (exportResult.current) URL.revokeObjectURL(exportResult.current.pdfUrl);
      exportResult.current = { pdfUrl: URL.createObjectURL(pdfBlob), swept: prepared.swept, files: prepared.files };
      setPhase("success");
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "The evidence pack could not be created.");
    }
  }

  // window.open(blobUrl, "_blank") is unreliable for this: a blob: URL is scoped to the
  // renderer process that created it, and a brand-new top-level browsing context opened via
  // window.open() can land in a different process that never resolves it (blank tab, no
  // error). A synthetic <a target="_blank"> click uses ordinary link-following navigation
  // instead and does not hit this -- the standard workaround for "open a generated blob in a
  // new tab" for exactly this reason.
  function openPdf() {
    if (!exportResult.current) return;
    const anchor = document.createElement("a");
    anchor.href = exportResult.current.pdfUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  async function saveBundleFromSuccess() {
    if (!exportResult.current) return;
    setSavingBundle(true);
    try { await downloadTracepackBundle(exportResult.current.swept, exportResult.current.files); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The .tracepack bundle could not be created."); }
    finally { setSavingBundle(false); }
  }

  function closeSuccess() {
    if (exportResult.current) { URL.revokeObjectURL(exportResult.current.pdfUrl); exportResult.current = null; }
    setPhase("idle");
  }

  async function runSecondaryExport(kind: "pdf" | "tracepack" | "epack" | "json") {
    setError(""); setOtherBusy(kind); setShowMore(false);
    try {
      if (kind === "json") { downloadJson(project); return; }
      const prepared = await prepareForExport();
      if (!prepared) return;
      if (kind === "pdf") { const blob = await buildEvidencePack(prepared.swept, prepared.files); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "evidence-pack.pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      else if (kind === "epack") await downloadEpackBundle(prepared.swept, prepared.files);
      else await downloadTracepackBundle(prepared.swept, prepared.files);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That file could not be created."); }
    finally { setOtherBusy(null); }
  }

  const hasIncludedEvidence = included.length === 0;
  const disablePrimary = phase !== "idle" || hasIncludedEvidence;

  return <main className="page export">
    <button className="back-link" onClick={back}>&larr; Back to workspace</button>
    <div className="export-title"><p className="eyebrow">Export</p><h1>{project.title}</h1></div>

    {missing.length > 0 && <div className="gap-card">
      <div className="head"><span className="dot" />This pack has {missing.length} evidence gap{missing.length === 1 ? "" : "s"}</div>
      <div className="gap-tally">{required > 0 && <span><b>{required}</b> required</span>}{recommended > 0 && <span><b>{recommended}</b> recommended</span>}</div>
      <p className="body">You can still export. The gaps will be recorded in the pack so anyone reviewing it can see exactly what's missing, not just what's included.</p>
      <button className="reveal" type="button" onClick={() => navigate("workspace")}>Review gaps &rarr;</button>
    </div>}
    {unresolved > 0 && <div className="alert" role="alert"><strong>{unresolved} privacy finding{unresolved === 1 ? "" : "s"} not reviewed.</strong><p>Review them before this pack can be downloaded.</p><button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => navigate("privacy")}>Go to privacy review</button></div>}
    {error && <div className="alert" role="alert">{error}</div>}

    <div className="contents-block">
      <div className="stack" aria-hidden="true">
        <div className="sheet s1">Cover</div>
        <div className="sheet s2">Index</div>
        <div className="sheet s3">Evidence</div>
      </div>
      <div className="facts">
        <p className="index-heading" style={{ border: 0, padding: 0, marginBottom: 2 }}>Pack contents</p>
        <div className="row"><span className="n">{included.length}</span><span>evidence item{included.length === 1 ? "" : "s"}</span></div>
        <div className={unresolved > 0 ? "row warn" : "row ok"}><span className="n">{unresolved}</span><span>privacy issue{unresolved === 1 ? "" : "s"} unresolved</span></div>
        <div className={missing.length > 0 ? "row warn" : "row ok"}><span className="n">{missing.length}</span><span>requirement gap{missing.length === 1 ? "" : "s"}</span></div>
        <div className="row"><span className="n mono">&#10003;</span><span>Manifest included</span></div>
      </div>
    </div>

    <p className="index-heading">Evidence index</p>
    {included.length === 0 ? <p style={{ color: "var(--muted)", padding: "16px 0" }}>No evidence is currently included.</p> : included.map((item, i) => <div className="index-row" key={item.id}>
      <span className="num">{String(i + 1).padStart(2, "0")}</span>
      <div><h3>{item.title}</h3><p className="meta">{project.template.categories.find((category) => category.id === item.categoryId)?.name} &middot; {item.sourceType.toUpperCase()} &middot; {item.eventDate || "No event date"}</p></div>
    </div>)}

    <div className="export-actions">
      <button className="btn btn-primary" disabled={disablePrimary} onClick={() => void runPrimaryExport()}>Export PDF evidence pack</button>
      <button className="more-toggle" type="button" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>{showMore ? "Fewer options ▲" : "More export options ▾"}</button>
      {showMore && <div className="more-panel">
        <button type="button" disabled={otherBusy !== null || hasIncludedEvidence} onClick={() => void runSecondaryExport("pdf")}>{otherBusy === "pdf" ? "Building…" : "PDF evidence pack"} <span className="fmt">.pdf</span></button>
        <button type="button" disabled={otherBusy !== null || hasIncludedEvidence} onClick={() => void runSecondaryExport("tracepack")}>{otherBusy === "tracepack" ? "Building…" : ".tracepack bundle"} <span className="fmt">.tracepack</span></button>
        <button type="button" disabled={otherBusy !== null || hasIncludedEvidence} onClick={() => void runSecondaryExport("epack")}>{otherBusy === "epack" ? "Building…" : "Evidence Pack (open format)"} <span className="fmt">.epack</span></button>
        <button type="button" disabled={otherBusy !== null} onClick={() => void runSecondaryExport("json")}>JSON manifest <span className="fmt">.json</span></button>
      </div>}
    </div>
    <p className="fine-print">Original evidence files are never modified. A .tracepack file is a zip archive; if a tool asks what to open it with, any zip/archive utility (or renaming it to .zip) works. .epack conforms to the open Evidence Pack v1 container format (locktivity/evidence-pack) -- the same redacted PDF as one embedded artifact, readable by any compatible tool, not just Tracepack.</p>

    {phase === "assembling" && <div className="overlay"><div className="overlay-card assembling">
      <div className="sheet-anim" aria-hidden="true">
        <div className="flying f1">Original evidence</div>
        <div className="flying f2">Privacy-reviewed</div>
        <div className="flying f3">Manifest</div>
        <div className="flying f4">Cover</div>
        <div className="final-stack">TRACEPACK<br />Evidence Pack</div>
      </div>
      <p className="status-line">Building your evidence pack&hellip;</p>
    </div></div>}

    {phase === "success" && <div className="overlay"><div className="overlay-card success">
      <div className="tick" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12.5L10 17.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
      <h2>Your pack is ready.</h2>
      <p className="sub">Original evidence remains unchanged.</p>
      <p className="format-note">.tracepack is a zip archive: any archive tool can open it.</p>
      <div className="actions">
        <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={openPdf}>Open PDF</button>
        <button className="btn btn-secondary" disabled={savingBundle} onClick={() => void saveBundleFromSuccess()}>{savingBundle ? "Saving…" : "Save .tracepack bundle"}</button>
      </div>
      <button className="btn btn-secondary btn-done" type="button" onClick={closeSuccess}>Done</button>
    </div></div>}
  </main>;
}
