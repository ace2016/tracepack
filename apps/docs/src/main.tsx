import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Item = { id: string; label: string };
type Group = { title: string; items: Item[] };

const nav: Group[] = [
  { title: "Get started", items: [
    { id: "first-pack", label: "Create your first pack" },
    { id: "add-evidence", label: "Add evidence" },
    { id: "review-privacy", label: "Review privacy" },
    { id: "export-pack", label: "Export a pack" },
  ]},
  { title: "Concepts", items: [
    { id: "evidence-model", label: "Evidence model" },
    { id: "provenance", label: "Provenance" },
    { id: "integrity", label: "Integrity & hashes" },
    { id: "human-decisions", label: "Human decisions" },
  ]},
  { title: "Integrations", items: [
    { id: "integrations", label: "Overview" },
    { id: "build-integration", label: "Build an integration" },
    { id: "adapt-workflow", label: "Adapt to your workflow" },
    { id: "woocommerce", label: "WooCommerce" },
    { id: "freescout", label: "FreeScout" },
    { id: "integration-security", label: "Security & trust" },
  ]},
  { title: "Developer tools", items: [
    { id: "sdk", label: "SDK" },
    { id: "attestation", label: "Pack attestations" },
    { id: "cli", label: "CLI" },
    { id: "evidence-format", label: "Evidence format" },
    { id: "handoff", label: "Browser handoff" },
  ]},
  { title: "Templates", items: [
    { id: "using-templates", label: "Using templates" },
    { id: "creating-templates", label: "Creating templates" },
    { id: "validation", label: "Validation" },
  ]},
];

const all = nav.flatMap((group) => group.items);

const toc: Record<string, string[]> = {
  "first-pack": ["What a pack is", "Open TracePack", "Choose a template", "Add evidence", "Review", "Export"],
  "add-evidence": ["Ways to add evidence", "Source evidence", "Browser captures", "External producers", "What to record"],
  "review-privacy": ["How privacy review works", "Findings are prompts", "Redaction", "Image limitation", "Before export"],
  "export-pack": ["When to export", "What is exported", "Integrity information", "What hashes do not prove"],
  "evidence-model": ["Five distinct layers", "Source Evidence", "External Observation", "TracePack Finding", "Human Decision", "Export Representation"],
  "provenance": ["What provenance records", "Producer claims", "Source URLs and timestamps", "Why attribution matters"],
  "integrity": ["Attachment integrity", "Payload integrity", "RFC 8785", "What integrity does not prove"],
  "human-decisions": ["Why human control matters", "Review boundary", "Redaction", "Reliance and evidential weight"],
  "integrations": ["Integration architecture", "What an integration does", "What it must not do", "Choose your pattern", "Examples"],
  "build-integration": ["1. Select data", "2. Build payload", "3. Hash attachments", "4. Compute payload hash", "5. Validate", "6. Start handoff", "7. Handle outcomes"],
  "adapt-workflow": ["Keep your internal model", "Build an adapter", "Map provenance", "Minimise data", "Suggest templates"],
  "woocommerce": ["Workflow", "Included fields", "Excluded fields", "Security boundary", "Template suggestion"],
  "freescout": ["Workflow", "Support desk pattern", "Preserve conversation context", "Review boundary"],
  "integration-security": ["Origin checks", "Replay protection", "Timeouts", "Producer identity", "Sensitive data", "Trust model"],
  "sdk": ["Install", "Build a payload", "Hash attachments", "Compute payload hash", "Validate", "JSON Schema", "Test vectors", "Versioning"],
  "attestation": ["Three packages", "Create a pack subject", "What is bound", "What it proves", "What it does not prove", "Sigstore privacy boundary"],
  "cli": ["Install", "validate-template", "validate-evidence", "diff-manifest", "Exit codes", "CI usage"],
  "evidence-format": ["What v1 is", "Top-level fields", "Attachments", "Observations", "Integrity", "Validation beyond JSON Schema"],
  "handoff": ["Install", "Create handoff", "Start handoff", "Origin checks", "Lifecycle acknowledgements", "Timeouts", "Template intent"],
  "using-templates": ["What templates control", "Categories", "Requirements", "Guidance", "Privacy rules", "Chronology rules"],
  "creating-templates": ["When to create one", "File location", "Required fields", "Worked YAML example", "Ship a template"],
  "validation": ["CLI validation", "What validation catches", "What it does not prove", "CI example"],
};

function Mark() {
  return <svg className="mark" viewBox="0 0 96 96" aria-hidden="true">
    <rect x="24" y="18" width="52" height="64" rx="10" transform="rotate(-6 50 50)" />
    <rect x="24" y="18" width="52" height="64" rx="10" transform="rotate(6 50 50)" />
    <circle className="hole" cx="50" cy="44" r="9" />
    <rect className="hole" x="46" y="50" width="8" height="18" rx="3" />
  </svg>;
}

function Flow({ steps }: { steps: string[] }) {
  return <div className="flow">{steps.map((step, i) => <span key={step}><b>{step}</b>{i < steps.length - 1 && <i>→</i>}</span>)}</div>;
}

function Code({ children }: { children: string }) {
  return <pre className="code"><code>{children}</code></pre>;
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="callout"><strong>{title}</strong><div>{children}</div></div>;
}

function Page({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children: React.ReactNode }) {
  return <article className="page">
    <p className="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    {lead && <p className="lead">{lead}</p>}
    <div className="body">{children}</div>
  </article>;
}

function App() {
  const initial = (location.hash || "#first-pack").slice(1);
  const [active, setActive] = useState(all.some((item) => item.id === initial) ? initial : "first-pack");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const id = (location.hash || "#first-pack").slice(1);
      if (all.some((item) => item.id === id)) setActive(id);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const label = useMemo(() => all.find((item) => item.id === active)?.label ?? "Documentation", [active]);

  const go = (id: string) => {
    setActive(id);
    setMenuOpen(false);
    history.replaceState(null, "", `#${id}`);
    scrollTo({ top: 0, behavior: "smooth" });
  };

  return <>
    <header>
      <a className="brand" href="https://tracepack.org"><Mark />TracePack <em>Docs</em></a>
      <nav>
        <a href="https://dev.tracepack.org">Developers</a>
        <a href="https://github.com/ace2016/tracepack">GitHub</a>
        <a className="open" href="https://app.tracepack.org">Open TracePack</a>
      </nav>
      <button className="menu" onClick={() => setMenuOpen((value) => !value)}>Menu</button>
    </header>

    <div className="shell">
      <aside className={menuOpen ? "sidebar show" : "sidebar"}>
        <div className="sidebarIntro">
          <strong>Documentation</strong>
          <small>Portable evidence with visible provenance.</small>
        </div>
        {nav.map((group) => <section className="navGroup" key={group.title}>
          <h2>{group.title}</h2>
          {group.items.map((item) => <button key={item.id} className={item.id === active ? "navItem active" : "navItem"} onClick={() => go(item.id)}>{item.label}</button>)}
        </section>)}
        <a className="source" href="https://github.com/ace2016/tracepack">View source ↗</a>
      </aside>

      <main>
        <div className="crumb">{label}</div>

        {active === "first-pack" && <Page eyebrow="Get started" title="Create your first pack" lead="Start with a local evidence workspace, collect source material, review what TracePack found and export a portable record when you are ready.">
          <Note title="Local first by default."><p>Your evidence stays in your browser unless you deliberately export it or hand it somewhere else. An account is not required to create a pack.</p></Note>
          <h2>What a pack is</h2>
          <p>A TracePack pack is a structured evidence workspace. It keeps source material, provenance, privacy findings, human decisions and export representations separate so you can understand what came from where.</p>
          <h2>1. Open TracePack</h2>
          <p>Open the workspace and choose <b>Create a pack</b>. Give the pack a title that will still make sense later, especially if you are building evidence over several days or weeks.</p>
          <a className="primary" href="https://app.tracepack.org">Open TracePack</a>
          <h2>2. Choose a template</h2>
          <p>Pick a template when one matches your situation. Templates define evidence categories, requirements, guidance and readiness checks. If no template fits, start with a general pack.</p>
          <div className="grid2"><div className="card"><span>Template</span><h3>Structured</h3><p>Useful when you want a checklist and scenario-specific guidance.</p></div><div className="card"><span>General</span><h3>Flexible</h3><p>Useful when you want to organise evidence without a predefined scenario.</p></div></div>
          <h2>3. Add evidence</h2>
          <p>Add PDFs or images manually, capture webpages with the browser extension, or receive a portable evidence payload from another product through a deliberate TracePack integration handoff.</p>
          <h2>4. Review</h2>
          <p>Check filenames, titles, source information, privacy findings and any external observations. TracePack findings are prompts for review. They are not automatically treated as fact.</p>
          <h2>5. Export</h2>
          <p>Export only after you are comfortable with the contents. The resulting evidence pack can include a human-readable PDF and source manifest information. Integrity hashes can help show whether bytes changed, but they do not prove that a claim is true or that a producer identity is genuine.</p>
          <div className="next"><span>Next</span><button onClick={() => go("add-evidence")}>Add evidence →</button></div>
        </Page>}

        {active === "add-evidence" && <Page eyebrow="Get started" title="Add evidence" lead="Bring material into a pack while preserving enough context to understand its origin later.">
          <h2>Ways to add evidence</h2>
          <div className="grid3"><div className="card"><h3>Upload</h3><p>Add PDFs and images from your device.</p></div><div className="card"><h3>Capture</h3><p>Use the browser extension for viewport or full-page capture.</p></div><div className="card"><h3>Integrate</h3><p>Receive evidence from an external product through a deliberate browser handoff.</p></div></div>
          <h2>Source evidence</h2><p>A source file is the material you are actually relying on: a receipt, screenshot, PDF, contract, letter, image or captured webpage. Keep the original bytes unchanged.</p>
          <h2>Browser captures</h2><p>For captured webpages, keep the source URL and capture time with the evidence so the exported pack can explain where the image or page came from.</p>
          <h2>External producers</h2><p>An integration can submit attachments and observations. Those observations remain attributed to the producer that reported them. TracePack does not silently convert a producer claim into a verified fact.</p>
          <h2>What to record</h2><ul><li>A useful title or filename.</li><li>The source or producer where available.</li><li>A timestamp when it helps establish chronology.</li><li>Only the personal data necessary for the pack's purpose.</li></ul>
          <Note title="Keep provenance visible."><p>Source Evidence, External Producer Observation, TracePack Finding and Human Decision are different layers. Keep them different.</p></Note>
        </Page>}

        {active === "review-privacy" && <Page eyebrow="Get started" title="Review privacy" lead="TracePack can surface possible privacy issues, but the decision to keep or redact material remains with you.">
          <h2>How privacy review works</h2><p>TracePack can inspect supported text and filenames for patterns that may represent personal information. A finding is added to the review workflow instead of altering your source evidence automatically.</p>
          <h2>Findings are prompts</h2><p>A privacy finding means “look here”. It does not mean TracePack has conclusively identified personal data, and the absence of a finding does not guarantee that a document is safe to share.</p>
          <h2>Redaction</h2><p>Redaction is human controlled and non-destructive. The source evidence remains intact while the export representation can reflect what you decided to remove.</p>
          <h2>Image limitation</h2><Note title="Do not assume complete OCR coverage."><p>TracePack does not currently provide complete OCR-based privacy detection for every image. Review images yourself before sharing a pack.</p></Note>
          <h2>Before export</h2><ul><li>Review every flagged item.</li><li>Check images manually.</li><li>Remove unnecessary personal information.</li><li>Confirm that redactions match your intended audience.</li></ul>
        </Page>}

        {active === "export-pack" && <Page eyebrow="Get started" title="Export a pack" lead="Turn reviewed evidence into a portable record without losing the distinction between originals, findings and decisions.">
          <h2>When to export</h2><p>Export after reviewing required categories, privacy findings and any chronology gaps that apply to the selected template.</p>
          <h2>What is exported</h2><p>The export path can produce a human-readable evidence pack and supporting manifest information describing evidence items, provenance and integrity data.</p>
          <h2>Integrity information</h2><p>Attachment hashes use SHA-256 over original bytes. This lets another system compare the bytes it received with the hash recorded for that attachment.</p>
          <h2>What hashes do not prove</h2><Note title="Integrity is not truth."><p>A matching hash does not prove who created a file, whether the content is accurate, or what evidential weight it should receive.</p></Note>
        </Page>}

        {active === "evidence-model" && <Page eyebrow="Concepts" title="Evidence model" lead="TracePack separates five things that are often collapsed together in evidence tooling.">
          <Flow steps={["Source Evidence", "External Observation", "TracePack Finding", "Human Decision", "Export Representation"]} />
          <h2>Source Evidence</h2><p>The original material you added or captured: bytes, source URL, timestamp, title and provenance.</p>
          <h2>External Producer Observation</h2><p>A structured claim made by another product. It remains attributed to that producer and is not automatically trusted.</p>
          <h2>TracePack Finding</h2><p>A result produced by TracePack, such as a privacy pattern or readiness signal. It is tool output, not a human conclusion.</p>
          <h2>Human Decision</h2><p>Your decision about what to keep, redact, rely on or include in the pack.</p>
          <h2>Export Representation</h2><p>The version of the evidence that appears in the exported pack. It may reflect human-controlled redaction while preserving the original source separately.</p>
        </Page>}

        {active === "provenance" && <Page eyebrow="Concepts" title="Provenance" lead="Provenance explains where an evidence item or observation came from and how it entered TracePack.">
          <h2>What provenance records</h2><p>Useful provenance can include producer information, source URLs, timestamps, attachment identifiers and external observation attribution.</p>
          <h2>Producer claims</h2><p>Producer identity in interchange v1 is self-asserted. A producer name and id tell you what the payload claims its source to be. They are not cryptographic identity verification.</p>
          <h2>Source URLs and timestamps</h2><p>For browser-captured evidence, a source URL and capture time help another reader understand the origin and chronology of the item.</p>
          <h2>Why attribution matters</h2><p>If an external tool says “order status was completed”, the pack should preserve that as an observation from the external producer rather than presenting it as an independently verified TracePack fact.</p>
        </Page>}

        {active === "integrity" && <Page eyebrow="Concepts" title="Integrity & hashes" lead="TracePack uses integrity information to detect changed bytes and changed structured payloads.">
          <h2>Attachment integrity</h2><p>Each attachment can carry a SHA-256 hash of its original binary bytes. Base64 transport does not change what those original bytes are.</p>
          <h2>Payload integrity</h2><p>The evidence payload can also carry its own SHA-256 integrity hash after canonicalisation. This helps detect changes to the structured payload.</p>
          <h2>RFC 8785</h2><p>TracePack uses RFC 8785 JSON Canonicalization Scheme for stable JSON bytes before computing the payload hash.</p>
          <h2>What integrity does not prove</h2><Note title="Separate integrity from authenticity."><p>Integrity does not establish verified human identity, authorship, truth, authenticity or evidential weight.</p></Note>
        </Page>}

        {active === "human-decisions" && <Page eyebrow="Concepts" title="Human decisions" lead="TracePack keeps consequential evidence decisions visible instead of hiding them behind automation.">
          <h2>Why human control matters</h2><p>An automated system can identify patterns or transport evidence, but it should not silently decide what a user relies on in a dispute, complaint or record.</p>
          <h2>Review boundary</h2><p>External integrations stop at an import review. The person using TracePack decides whether incoming evidence belongs in the local pack.</p>
          <h2>Redaction</h2><p>Privacy findings can lead to a human-controlled redaction decision. Source evidence is not destructively rewritten.</p>
          <h2>Reliance and evidential weight</h2><p>Hashes, producer observations and TracePack findings can inform a decision. None of them replace the human judgement about whether material is relevant or reliable.</p>
        </Page>}

        {active === "integrations" && <Page eyebrow="Integrations" title="Connect another product to TracePack" lead="Prepare portable evidence in your own workflow, then hand control to the person using TracePack.">
          <h2>Integration architecture</h2><Flow steps={["Your product", "your adapter", "tracepack-evidence v1", "@tracepack/integration", "TracePack review"]} />
          <Note title="Nothing is silently added."><p>The user starts the handoff, TracePack presents an import review, and the user decides what to accept.</p></Note>
          <h2>What an integration does</h2><p>An integration selects useful evidence from your product, maps it into the frozen v1 evidence contract, validates it, starts a versioned browser handoff and handles the resulting lifecycle outcome.</p>
          <h2>What it must not do</h2><ul><li>Do not silently add evidence to a pack.</li><li>Do not send credentials, card details or unrelated personal data.</li><li>Do not treat producer identity as cryptographically verified.</li><li>Do not describe SHA-256 as proof that a claim is true.</li></ul>
          <h2>Choose your pattern</h2><div className="grid3"><div className="card"><h3>CMS / commerce</h3><p>Map an order or record into a minimal evidence snapshot.</p></div><div className="card"><h3>Support desk</h3><p>Carry conversation evidence while preserving who said what.</p></div><div className="card"><h3>Internal tool</h3><p>Adapt your own domain model at the boundary instead of rewriting your application.</p></div></div>
          <h2>Examples</h2><p>WooCommerce demonstrates the order-record pattern. FreeScout demonstrates the support-conversation pattern.</p>
        </Page>}

        {active === "build-integration" && <Page eyebrow="Integrations" title="Build an integration" lead="Use the SDK for the evidence contract and @tracepack/integration for the deliberate browser handoff.">
          <h2>1. Select the data</h2><p>Start with the minimum evidence that serves the user's purpose. Do not copy arbitrary database metadata into the payload.</p>
          <h2>2. Build the payload</h2><Code>{`import {
  type TracepackEvidencePayloadV1
} from "@tracepack/evidence-sdk";

const draft = {
  schema_version: 1,
  source: {
    producer_id: "org.example.your-tool",
    producer_name: "Your Tool"
  },
  capture_timestamp: new Date().toISOString(),
  evidence_type: "product_record",
  attachments: [],
  observations: [],
  integrity: {
    algorithm: "sha256",
    canonicalization: "RFC8785",
    payload_hash: ""
  }
};`}</Code>
          <h2>3. Hash attachments</h2><p>Hash the original binary bytes before base64 encoding.</p><Code>{`const contentHash = await sha256Hex(originalFileBytes);`}</Code>
          <h2>4. Compute the payload hash</h2><Code>{`const payload = {
  ...draft,
  integrity: {
    ...draft.integrity,
    payload_hash: await computePayloadHash(draft)
  }
};`}</Code>
          <h2>5. Validate</h2><Code>{`const result = validateEvidencePayload(payload);
if (!result.ok) {
  console.error(result.issues);
}`}</Code>
          <h2>6. Start the handoff</h2><Code>{`import {
  createTracepackHandoff,
  startTracepackBrowserHandoff
} from "@tracepack/integration";`}</Code>
          <p>Start from a deliberate user action. The handoff protocol includes target-origin checks, unique handoff identifiers, version checks, source checks, acknowledgements, replay protection and timeouts.</p>
          <h2>7. Handle outcomes</h2><p>Your integration should handle the lifecycle result rather than assuming evidence was accepted. A valid payload can still be rejected by the user.</p>
        </Page>}

        {active === "adapt-workflow" && <Page eyebrow="Integrations" title="Adapt TracePack to your workflow" lead="Keep your database and domain model. Add a small adapter at the evidence boundary.">
          <Flow steps={["Your internal model", "Your adapter", "TracePack contract"]} />
          <h2>Keep your internal model</h2><p>You do not need to rename fields, redesign your database or make TracePack concepts your application's primary domain model.</p>
          <h2>Build an adapter</h2><p>Select the few fields that matter to the evidence record and map them into attachments, observations, source information and metadata allowed by the v1 contract.</p>
          <h2>Map provenance</h2><p>Use stable producer ids and meaningful source references. Do not convert an external observation into source evidence just because it is convenient.</p>
          <h2>Minimise data</h2><p>Prefer an explicit allowlist of safe fields. This is especially important for commerce systems, CRMs and support tools where arbitrary metadata can contain credentials, payment data or unrelated PII.</p>
          <h2>Suggest templates</h2><p>An integration may suggest a TracePack template when it knows the likely workflow, while leaving the final choice with the user.</p>
        </Page>}

        {active === "woocommerce" && <Page eyebrow="Example integration" title="WooCommerce" lead="A deliberate order-to-evidence handoff for WooCommerce administrators.">
          <h2>Workflow</h2><Flow steps={["WooCommerce order", "Send to TracePack", "safe order snapshot", "browser handoff", "TracePack review"]} />
          <p>The plugin uses a deliberate administrator action. It builds a minimal order evidence payload and opens TracePack for review rather than uploading evidence server-to-server.</p>
          <h2>Included fields</h2><ul><li>Order reference, created date, status and currency.</li><li>Line items and totals.</li><li>Payment method title and transaction reference when present.</li><li>Paid date, completed date and shipping methods when present.</li></ul>
          <h2>Excluded fields</h2><ul><li>Customer email and phone.</li><li>Billing and shipping addresses.</li><li>Full payment-card details.</li><li>Credentials and secrets.</li><li>Arbitrary WooCommerce order metadata.</li></ul>
          <h2>Security boundary</h2><p>The WordPress side checks administrator capability and an order-specific nonce before preparing the handoff. Evidence is not silently persisted after the response.</p>
          <h2>Template suggestion</h2><p>The integration can suggest <code>woocommerce-order-evidence</code> so the user starts with a relevant structure while retaining the ability to review the incoming evidence.</p>
          <a className="textLink" href="https://github.com/ace2016/tracepack/tree/main/integrations/woocommerce">View the WooCommerce integration ↗</a>
        </Page>}

        {active === "freescout" && <Page eyebrow="Example integration" title="FreeScout" lead="The support-desk pattern for carrying a conversation into a TracePack evidence review.">
          <h2>Workflow</h2><Flow steps={["FreeScout conversation", "Send to TracePack", "conversation evidence", "browser handoff", "review"]} />
          <h2>Support desk pattern</h2><p>A support integration often starts with a conversation rather than a file. The adapter should preserve useful context such as message order, timestamps and attribution instead of flattening everything into an anonymous block of text.</p>
          <h2>Preserve conversation context</h2><p>If the integration produces structured observations, keep them attributed to FreeScout as the external producer. Attachments should preserve their own filenames, content types and hashes.</p>
          <h2>Review boundary</h2><p>The user chooses whether the conversation evidence belongs in the pack. The external producer does not get to make that decision silently.</p>
          <a className="textLink" href="https://github.com/ace2016/tracepack/tree/main/integrations/freescout">View the FreeScout integration ↗</a>
        </Page>}

        {active === "integration-security" && <Page eyebrow="Integrations" title="Security & trust" lead="The browser handoff is designed as a trust boundary, not a shortcut around one.">
          <h2>Origin checks</h2><p>The integration protocol supports explicit target-origin checks so messages are not accepted from an unexpected destination.</p>
          <h2>Replay protection</h2><p>Unique handoff identifiers and lifecycle checks help prevent an old handoff from being replayed as if it were new.</p>
          <h2>Timeouts</h2><p>A producer should treat a timeout as a real outcome. Do not assume that an unanswered handoff means evidence was imported.</p>
          <h2>Producer identity</h2><p>Producer identity in interchange v1 is self-asserted. It is useful attribution, not authenticated human or organisational identity.</p>
          <h2>Sensitive data</h2><p>Use explicit allowlists. Never send secrets, credentials, payment-card details or unrelated personal data simply because they are available in the source application.</p>
          <h2>Trust model</h2><Flow steps={["Attachment integrity", "Payload integrity", "Producer claim", "Human review"]} /><p>Each step answers a different question. Do not collapse them into a single “verified” label.</p>
        </Page>}

        {active === "sdk" && <Page eyebrow="Developer tools" title="TypeScript SDK" lead="Use @tracepack/evidence-sdk to build, validate, canonicalise and hash tracepack-evidence v1 payloads.">
          <h2>Install</h2><Code>{"npm install @tracepack/evidence-sdk"}</Code>
          <h2>Build a payload</h2><p>The SDK provides the frozen v1 types and validation helpers. Your producer still decides what evidence to collect and how to read its own files.</p>
          <Code>{`import {
  validateEvidencePayload,
  computePayloadHash,
  sha256Hex,
  type TracepackEvidencePayloadV1
} from "@tracepack/evidence-sdk";`}</Code>
          <h2>Hash attachments</h2><p>Hash each attachment's original bytes before base64 encoding.</p><Code>{`const contentHash = await sha256Hex(originalFileBytes);`}</Code>
          <h2>Compute the payload hash</h2><p>TracePack canonicalises the structured payload according to RFC 8785 and computes SHA-256 over the canonical form using the contract's defined exclusions.</p>
          <h2>Validate</h2><Code>{`const result = validateEvidencePayload(payload);
if (!result.ok) {
  console.error(result.issues);
}`}</Code>
          <h2>JSON Schema</h2><p>The package ships the machine-readable v1 JSON Schema. The schema alone is not the entire contract because some duplicate-id, reference, calendar-date and unsafe-metadata checks are semantic or cross-field rules.</p>
          <h2>Test vectors</h2><p>Language-agnostic conformance vectors cover attachment hashes, payload hashes and pass/fail validation cases. Reproduce them when implementing the contract outside TypeScript.</p>
          <h2>Versioning</h2><p><code>schema_version: 1</code> is frozen. The npm package can receive fixes independently without changing what the v1 wire contract means.</p>
          <a className="textLink" href="https://github.com/ace2016/tracepack/tree/main/packages/evidence-sdk">View SDK source and README ↗</a>
        </Page>}

        {active === "attestation" && <Page eyebrow="Developer tools" title="Pack attestations" lead="Bind independently verifiable statements and signing identities to one immutable TracePack pack digest.">
          <h2>Three packages</h2><ul><li><code>@tracepack/attestation</code> defines the portable Attestation v1 statement, verification and policy model.</li><li><code>@tracepack/attestation-sigstore</code> signs and verifies attestations with Sigstore.</li><li><code>@tracepack/pack-attestation</code> creates deterministic pack snapshots and attestation subjects after verifying included evidence bytes.</li></ul>
          <h2>Create a pack subject</h2><Code>{`import {
  createPackSnapshot,
  packSnapshotToAttestationSubject
} from "@tracepack/pack-attestation";

const snapshot = createPackSnapshot(project, packVersion);
const subject = await packSnapshotToAttestationSubject(snapshot, evidenceFiles);`}</Code>
          <h2>What is bound</h2><p>The pack subject binds the deterministic snapshot, pack version and included evidence content. Included evidence bytes are checked against their recorded SHA-256 hashes before the subject is finalized.</p>
          <h2>What it proves</h2><p>A valid attestation can show that a verified signing identity signed a statement about that pack subject digest. Policy evaluation can require more than one independent attestation.</p>
          <h2>What it does not prove</h2><Note title="Signing identity is not producer identity."><p>Attestation does not authenticate the self-asserted <code>producer_id</code> inside a <code>tracepack-evidence</code> v1 payload, prove that evidence is true, or establish who originally created the evidence.</p></Note>
          <h2>Sigstore privacy boundary</h2><p>Evidence file contents are not submitted to Sigstore by the attestation signing flow. The canonical attestation statement is signed, and that statement contains its pack subject digest. Transparency-log upload is enabled by default, so do not place secrets or unnecessary personal data in attestation statements.</p>
          <a className="textLink" href="https://github.com/ace2016/tracepack/tree/main/packages/attestation">Read the Attestation v1 specification ↗</a>
        </Page>}

        {active === "cli" && <Page eyebrow="Developer tools" title="CLI" lead="Run TracePack validation and manifest comparison outside the browser, including in CI.">
          <h2>Install</h2><Code>{`npm install -g @tracepack/cli

# or run without installing
npx @tracepack/cli --help`}</Code>
          <h2>validate-template</h2><Code>{"tracepack validate-template templates/my-template/template.yaml"}</Code><p>Loads the real template schema and reports structural errors such as missing fields, empty category arrays or invalid privacy regex patterns.</p>
          <h2>validate-evidence</h2><Code>{"tracepack validate-evidence payload.json"}</Code><p>Runs the same structural and semantic validation scope as the evidence SDK. It does not decode attachment bytes to prove that recorded hashes match their content.</p>
          <h2>diff-manifest</h2><Code>{"tracepack diff-manifest before.json after.json"}</Code><p>Compares evidence items by id and content hash. Additions, removals and ordinary metadata edits are reported. A changed content hash under the same id is treated as an anomaly.</p>
          <h2>Exit codes</h2><ul><li><b>0</b> for valid files and normal manifest differences.</li><li><b>1</b> for validation failure or a manifest content-hash anomaly.</li><li><b>2</b> when an input file cannot be read.</li></ul>
          <h2>CI usage</h2><Code>{`- run: npx @tracepack/cli validate-template templates/my-template/template.yaml`}</Code>
          <a className="textLink" href="https://github.com/ace2016/tracepack/tree/main/packages/cli">View CLI source and README ↗</a>
        </Page>}

        {active === "evidence-format" && <Page eyebrow="Developer tools" title="Evidence format" lead="tracepack-evidence v1 is the portable contract an external producer uses to hand structured evidence to TracePack.">
          <h2>What v1 is</h2><p>The format describes source information, capture time, evidence type, attachments, observations and integrity data without depending on TracePack's browser storage implementation.</p>
          <h2>Top-level fields</h2><ul><li><code>schema_version</code></li><li><code>source</code></li><li><code>capture_timestamp</code></li><li><code>evidence_type</code></li><li><code>attachments</code></li><li><code>observations</code></li><li><code>integrity</code></li></ul>
          <h2>Attachments</h2><p>Attachments carry identifiers, filename, MIME type, size, original-byte content hash, encoding and base64 data.</p>
          <h2>Observations</h2><p>Observations are producer claims. They remain external observations after import instead of being relabelled as TracePack findings.</p>
          <h2>Integrity</h2><p>Attachment integrity and payload integrity are separate. The payload uses RFC 8785 canonicalisation plus SHA-256.</p>
          <h2>Validation beyond JSON Schema</h2><p>Some contract rules need semantic validation beyond schema syntax, including duplicate identifiers, dangling references, real calendar-date checks and unsafe metadata keys.</p>
          <a className="textLink" href="https://github.com/ace2016/tracepack/tree/main/packages/evidence-interchange">Read the interchange specification ↗</a>
        </Page>}

        {active === "handoff" && <Page eyebrow="Developer tools" title="Browser handoff" lead="@tracepack/integration moves a validated payload from another product into TracePack through a deliberate, versioned browser protocol.">
          <h2>Install</h2><Code>{"npm install @tracepack/integration"}</Code>
          <h2>Create handoff</h2><Code>{`import {
  createTracepackHandoff,
  startTracepackBrowserHandoff
} from "@tracepack/integration";`}</Code>
          <h2>Start handoff</h2><p>Start from a deliberate user action and open the TracePack import destination. Wait until the receiving workspace is ready before sending the payload.</p>
          <h2>Origin checks</h2><p>The protocol supports explicit target origins and message source checking.</p>
          <h2>Lifecycle acknowledgements</h2><p>Handoff messages use acknowledgements so the producer can distinguish an accepted protocol exchange from silence or failure.</p>
          <h2>Timeouts</h2><p>A timeout is a real result. Do not interpret it as successful import.</p>
          <h2>Template intent</h2><p>The handoff can carry a template recommendation while preserving the user's ability to review and choose where the evidence belongs.</p>
          <a className="textLink" href="https://github.com/ace2016/tracepack/tree/main/packages/integration">View integration package ↗</a>
        </Page>}

        {active === "using-templates" && <Page eyebrow="Templates" title="Using templates" lead="A template shapes what a pack asks for without changing the underlying evidence model.">
          <h2>What templates control</h2><p>Templates define categories, requirements, accepted evidence types, export sections and optional guidance, privacy rules and chronology rules.</p>
          <h2>Categories</h2><p>A category describes a logical evidence group such as tenancy agreement, correspondence, payment record or photographs.</p>
          <h2>Requirements</h2><p>Categories can be required, recommended or optional, and can set minimum item counts where the template needs them.</p>
          <h2>Guidance</h2><p>Template guidance can explain what belongs in a category or what the user should check before considering that category complete.</p>
          <h2>Privacy rules</h2><p>Optional privacy rules can add scenario-specific text patterns to the normal review flow.</p>
          <h2>Chronology rules</h2><p>Templates can opt into continuity checks such as a maximum allowed gap between dated evidence. Templates without chronology rules do not receive those checks.</p>
        </Page>}

        {active === "creating-templates" && <Page eyebrow="Templates" title="Creating templates" lead="Create a new template when the workflow needs different evidence categories or requirements, not when it needs entirely new application behaviour.">
          <h2>When to create one</h2><p>If the need is a different checklist for an existing evidence workflow, a template is appropriate. If you need a new source type or validation behaviour, that is a code change rather than a template-only change.</p>
          <h2>File location</h2><Code>{`templates/
  your-template-id/
    template.yaml`}</Code>
          <h2>Required fields</h2><p>A template includes <code>id</code>, <code>name</code>, <code>version</code>, <code>jurisdiction</code>, at least one category and at least one export section.</p>
          <h2>Worked YAML example</h2><Code>{`id: tenancy-deposit
name: Tenancy deposit dispute
version: 0.1.0
jurisdiction: UK

categories:
  - id: tenancy_agreement
    name: Tenancy agreement
    requirement: required
    description: The signed tenancy agreement.
    accepted_types: [pdf, image]

  - id: correspondence
    name: Correspondence about the deposit
    requirement: recommended
    description: Messages or emails about the deposit deduction.
    accepted_types: [pdf, image, webpage, note]

export_sections:
  - cover
  - evidence_checklist
  - timeline
  - evidence_index
  - evidence_documents
  - source_manifest`}</Code>
          <h2>Ship a template</h2><p>The workspace imports shipped template YAML files explicitly in <code>apps/workspace/src/template.ts</code>. Adding a template means adding the YAML file and adding it to that explicit shipped-template list.</p>
          <Note title="Templates do not add shared multi-party ownership."><p>A landlord/tenant template can organise one party's evidence today. Jointly building or signing the same pack is a separate product capability.</p></Note>
          <a className="textLink" href="https://github.com/ace2016/tracepack/blob/main/templates/CONTRIBUTING.md">Read the template contribution guide ↗</a>
        </Page>}

        {active === "validation" && <Page eyebrow="Templates" title="Template validation" lead="Validate templates with the same schema the TracePack workspace uses.">
          <h2>CLI validation</h2><Code>{"npx @tracepack/cli validate-template templates/your-id/template.yaml"}</Code>
          <h2>What validation catches</h2><p>Examples include missing required fields, empty category arrays and privacy regex patterns that cannot be parsed.</p>
          <h2>What it does not prove</h2><p>A structurally valid template can still be a poor product design. Validation proves conformance to the schema, not that the checklist is legally sufficient or appropriate for every situation.</p>
          <h2>CI example</h2><Code>{`- run: npx @tracepack/cli validate-template templates/my-template/template.yaml`}</Code>
        </Page>}
      </main>

      <aside className="toc">
        <strong>On this page</strong>
        <span className="tocTitle">{label}</span>
        {(toc[active] ?? []).map((entry) => <span key={entry}>{entry}</span>)}
      </aside>
    </div>
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
