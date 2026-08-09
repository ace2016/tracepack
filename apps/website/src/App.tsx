import { useState } from "react";
import { Onboarding } from "./Onboarding";

function Mark({ inverse = false }: { inverse?: boolean }) {
  return <svg className="mark" viewBox="0 0 96 96" aria-hidden="true">
    <rect fill={inverse ? "#fffef9" : "#1d3c2d"} x="24" y="18" width="52" height="64" rx="10" transform="rotate(-6 50 50)" />
    <rect fill={inverse ? "#fffef9" : "#1d3c2d"} x="24" y="18" width="52" height="64" rx="10" transform="rotate(6 50 50)" />
    <circle fill={inverse ? "#17231d" : "#fffef9"} cx="50" cy="44" r="9" />
    <rect fill={inverse ? "#17231d" : "#fffef9"} x="46" y="50" width="8" height="18" rx="3" />
  </svg>;
}

function EvidenceStory() {
  return <div className="story" aria-label="Evidence moving through TracePack">
    <div className="storybar"><Mark inverse /><span>TracePack</span><span className="local"><i /> Stored here</span></div>
    <div className="storybody">
      <div className="incoming">
        <div className="file file1"><b>PDF</b><span>Tenancy agreement</span></div>
        <div className="file file2"><b>IMG</b><span>Property photo</span></div>
        <div className="file file3"><b>WEB</b><span>Captured page</span></div>
      </div>
      <div className="storyline"><span /></div>
      <div className="storypack"><Mark /><strong>Evidence pack</strong><small>12 items organised</small></div>
      <div className="checks">
        <span><i>1</i> Evidence gathered</span>
        <span><i>2</i> Privacy reviewed</span>
        <span><i>3</i> Ready to export</span>
      </div>
    </div>
  </div>;
}

type DemoKind = "cli" | "sdk" | "format";

const DEMOS: Record<DemoKind, { label: string; title: string; lines: { kind: string; text: string }[] }> = {
  cli: { label: "CLI", title: "Validate evidence before it moves", lines: [
    { kind: "command", text: "tracepack validate-evidence record.json" },
    { kind: "success", text: "Valid tracepack-evidence v1 payload" },
    { kind: "plain", text: "Producer: Example Tool" },
    { kind: "plain", text: "2 attachments, 1 observation" },
    { kind: "notice", text: "Producer identity is self asserted" },
  ]},
  sdk: { label: "SDK", title: "Build against the open evidence contract", lines: [
    { kind: "code", text: "import { validateEvidencePayload }" },
    { kind: "code", text: "  from '@tracepack/evidence-sdk';" },
    { kind: "code", text: "const result = validateEvidencePayload(payload);" },
    { kind: "success", text: "result.success  true" },
    { kind: "notice", text: "Ready to send to TracePack" },
  ]},
  format: { label: "Evidence format", title: "A portable record with clear provenance", lines: [
    { kind: "code", text: "schema_version: 1" },
    { kind: "code", text: "producer_name: 'Example Tool'" },
    { kind: "code", text: "evidence_type: 'supporting_record'" },
    { kind: "success", text: "attachment hash matches" },
    { kind: "notice", text: "Human review still required" },
  ]},
};

function DeveloperDemo() {
  const [active, setActive] = useState<DemoKind>("cli");
  const demo = DEMOS[active];
  return <div className="devDemo">
    <div className="demoTabs" role="tablist" aria-label="Developer demonstrations">
      {(Object.keys(DEMOS) as DemoKind[]).map((kind) => <button key={kind} className={active === kind ? "active" : ""} onClick={() => setActive(kind)} role="tab" aria-selected={active === kind}>{DEMOS[kind].label}</button>)}
    </div>
    <div className="terminal" key={active}>
      <div className="termTop"><span/><span/><span/><b>{demo.title}</b></div>
      <div className="demoLines">{demo.lines.map((line, index) => <div className={`demoLine ${line.kind}`} style={{ animationDelay: `${index * 0.48}s` }} key={line.text}>{line.kind === "command" && <em>$</em>}{line.kind === "success" && <em>✓</em>}{line.kind === "notice" && <em>i</em>}<code>{line.text}</code></div>)}</div>
    </div>
    <p className="demoTruth">Integrity can be checked by software. Meaning and evidential weight still need human judgement.</p>
  </div>;
}

export function App() {
  const [intro, setIntro] = useState(false);
  return <>
    {intro && <Onboarding onFinish={() => setIntro(false)} />}
    <header className="nav"><a className="brand" href="#top"><Mark />TracePack</a>
      <nav><a href="#how">How it works</a><a href="#developers">For developers</a><a href="#privacy">Privacy</a><a href="#open">Open source</a></nav>
      <a className="button small" href="https://app.tracepack.org">Open TracePack</a>
    </header>
    <main id="top">
      <section className="hero section">
        <div className="heroCopy"><p className="eyebrow">A local first evidence workspace</p><h1>Make sense of the evidence you already have.</h1>
          <p className="lead">Bring together documents, screenshots, photos and records. TracePack helps you review what matters, protect private details and build a pack that is easy to follow.</p>
          <div className="actions"><a className="button" href="https://app.tracepack.org">Open TracePack</a><a className="button quiet" href="#how">See how it works</a></div>
          <p className="reassure"><span>●</span> No account needed. Your evidence stays in this browser.</p>
        </div><EvidenceStory />
      </section>

      <section className="truststrip"><span>Made for evidence that needs care</span><b>Originals stay unchanged</b><b>Gaps remain visible</b><b>Every item keeps its history</b></section>

      <section className="section how" id="how"><div className="sectionHead"><p className="eyebrow">From scattered files to a clear record</p><h2>A calmer way to build an evidence pack.</h2><p>TracePack keeps the work understandable. You remain in control of every decision.</p><button className="introLink" onClick={() => setIntro(true)}>Preview the first time introduction <span>→</span></button></div>
        <div className="steps">
          <article><div className="stepIll filesIll"><span>PDF</span><span>JPG</span><span>WEB</span></div><small>01</small><h3>Bring your evidence together</h3><p>Add files, capture a webpage or receive a record from another tool.</p></article>
          <article><div className="stepIll reviewIll"><div className="paper"><i/><i/><i/></div><b>✓</b></div><small>02</small><h3>Review it with care</h3><p>Check private details, understand where each item came from and make your own decisions.</p></article>
          <article><div className="stepIll packIll"><Mark /><span>Ready</span></div><small>03</small><h3>Share a pack that explains itself</h3><p>Export an organised record with an index, chronology and integrity information.</p></article>
        </div>
      </section>

      <section className="forest" id="privacy"><div><p className="eyebrow lime">Local first by design</p><h2>Your evidence is not our business.</h2><p className="forestLead">TracePack works in your browser. There is no account to create and no automatic upload. You choose what enters a pack and when it leaves your device.</p><a className="textlink" href="https://docs.tracepack.org">Read about privacy <span>→</span></a></div>
        <div className="privacyVisual"><div className="device"><div className="deviceTop"><Mark inverse /> tracepack.org</div><div className="safe"><div className="safeRing"><Mark /></div><strong>Stored on this device</strong><span>Nothing has been uploaded</span></div></div><div className="offlineTag">Cloud connection off</div></div>
      </section>

      <section className="section developer" id="developers"><div><p className="eyebrow">For developers and other products</p><h2>TracePack can meet evidence where it begins.</h2><p className="lead">Use the open evidence format, SDK and command line tools to create records that people can inspect in TracePack. Technical provenance stays visible without taking human judgement away.</p><div className="devlinks"><a href="https://dev.tracepack.org/#start">Explore the SDK</a><a href="https://dev.tracepack.org/#start">Read the CLI guide</a><a href="https://dev.tracepack.org/#format">View the evidence format</a></div></div>
        <div className="developerInvite"><Mark /><strong>TracePack for developers</strong><p>Use the CLI, TypeScript SDK and open evidence format to create portable records with visible provenance.</p><a className="button" href="https://dev.tracepack.org">Visit the developer site</a></div>
      </section>

      <section className="section open" id="open"><div className="openMark"><Mark /></div><p className="eyebrow">Open source</p><h2>Evidence should remain portable.</h2><p>TracePack is being built in the open so evidence can move between people and tools without being trapped in one service.</p><div className="actions center"><a className="button" href="https://github.com/ace2016/tracepack">View on GitHub</a><a className="button quiet" href="https://docs.tracepack.org">Read the documentation</a></div></section>
    </main>
    <footer><a className="brand" href="#top"><Mark />TracePack</a><p>Clear evidence. Human decisions. Your device.</p><div><a href="#privacy">Privacy</a><a href="#developers">Developers</a><a href="https://github.com/ace2016/tracepack">GitHub</a></div></footer>
  </>;
}
