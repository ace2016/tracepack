import { useState } from "react";

export interface OnboardingProps {
  onFinish: () => void;
}

interface StepContent {
  eyebrow: string;
  head: string;
  body: string;
  foot?: string;
  illustration: "lock" | "files" | "doc" | "pack";
}

const STEPS: StepContent[] = [
  {
    eyebrow: "Before you start",
    head: "Everything stays on this device.",
    body: "TracePack builds your evidence pack entirely in this browser. No account, no upload, and nothing leaves your device until you choose to export.",
    illustration: "lock",
  },
  {
    eyebrow: "Step 1",
    head: "Bring in your evidence.",
    body: "Import PDFs, photos and screenshots. TracePack sorts each item into your template's categories and reads any text layer automatically.",
    illustration: "files",
  },
  {
    eyebrow: "Step 2",
    head: "You decide what gets redacted.",
    body: "Emails, phone numbers and other patterns are flagged for your review. Nothing is removed until you approve it, and your originals are never changed.",
    illustration: "doc",
  },
  {
    eyebrow: "Step 3",
    head: "Export a clean evidence pack.",
    body: "A cover page, evidence index and flattened redactions all bundled into one PDF, plus a JSON manifest with hashes so nothing can be quietly altered.",
    foot: "Local storage is not a backup. Clearing browser data removes these projects, so export early and export often.",
    illustration: "pack",
  },
];

// Remounting the active illustration (via a changing key) is React's equivalent of the
// mockup's "remove is-playing, force reflow, re-add is-playing" trick -- a fresh element
// instance always restarts its CSS animations, a toggled class on a live one does not.
function Illustration({ variant, playKey }: { variant: StepContent["illustration"]; playKey: number }) {
  if (variant === "lock") {
    return (
      <div className="ob-illustration is-playing" key={playKey}>
        <svg viewBox="0 0 260 168" className="il-lock" aria-hidden="true">
          <defs>
            <filter id="lockGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>
          <circle className="glow g1" cx="130" cy="94" r="40" />
          <circle className="glow g2" cx="130" cy="94" r="40" />
          <circle className="glow g3" cx="130" cy="94" r="40" />
          <path className="shackle" d="M110 74 v-18 a20 20 0 0 1 40 0 v18" />
          <rect className="body" x="98" y="74" width="64" height="52" rx="12" />
          <circle className="keyhole" cx="130" cy="96" r="6" />
          <rect className="keyhole" x="127" y="96" width="6" height="16" rx="2" />
          <g className="offline" transform="translate(184,38)">
            <path d="M-15 5 a8 8 0 0 1 2.5 -15.8 a11.5 11.5 0 0 1 22 3 a7.2 7.2 0 0 1 -0.8 14.8 h-19.5 a6.2 6.2 0 0 1 -4.2 -2z" fill="none" stroke="#9aa69d" strokeWidth="2.2" />
            <line x1="-17" y1="-11" x2="11" y2="17" stroke="#9aa69d" strokeWidth="2.2" strokeLinecap="round" />
          </g>
        </svg>
      </div>
    );
  }
  if (variant === "files") {
    return (
      <div className="ob-illustration is-playing" key={playKey}>
        <svg viewBox="0 0 260 168" className="il-files" aria-hidden="true">
          <defs>
            <filter id="cardShadow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#17231d" floodOpacity="0.16" />
            </filter>
          </defs>

          <rect className="slot" x="24" y="98" width="70" height="54" rx="11" />
          <rect className="slot-ring r1" x="24" y="98" width="70" height="54" rx="11" />
          <g className="slot-icon">
            <rect x="48" y="110" width="22" height="16" rx="3" />
            <rect className="fill-lime" x="65" y="107" width="6" height="6" rx="3" />
            <rect className="fill-ink" x="52" y="115" width="10" height="2" rx="1" />
            <rect className="fill-ink" x="52" y="119" width="7" height="2" rx="1" />
          </g>
          <text className="slot-label" x="59" y="141" textAnchor="middle">PURCHASE</text>

          <rect className="slot" x="100" y="98" width="70" height="54" rx="11" />
          <rect className="slot-ring r2" x="100" y="98" width="70" height="54" rx="11" />
          <g className="slot-icon">
            <rect x="124" y="110" width="22" height="16" rx="3" />
            <path d="M124 110 L135 120 L146 110" />
          </g>
          <text className="slot-label" x="135" y="141" textAnchor="middle">MESSAGES</text>

          <rect className="slot" x="176" y="98" width="58" height="54" rx="11" />
          <rect className="slot-ring r3" x="176" y="98" width="58" height="54" rx="11" />
          <g className="slot-icon">
            <rect x="194" y="110" width="22" height="16" rx="3" />
            <circle className="fill-lime" cx="200.5" cy="115" r="2" />
            <path className="fill-ink" d="M195 124.5 L200.5 117.5 L204.5 121.5 L208 118 L211 124.5 Z" />
          </g>
          <text className="slot-label" x="205" y="141" textAnchor="middle">PHOTOS</text>

          <g className="tag t1">
            <rect className="card" width="40" height="28" rx="7" />
            <path className="fold" d="M30 0 H40 V10 Z" />
            <circle className="dot" cx="8" cy="21" r="3" />
            <text x="21" y="19" textAnchor="middle">PDF</text>
          </g>
          <g className="tag t2">
            <rect className="card" width="40" height="28" rx="7" />
            <path className="fold" d="M30 0 H40 V10 Z" />
            <circle className="dot" cx="8" cy="21" r="3" />
            <text x="21" y="19" textAnchor="middle">JPG</text>
          </g>
          <g className="tag t3">
            <rect className="card" width="40" height="28" rx="7" />
            <path className="fold" d="M30 0 H40 V10 Z" />
            <circle className="dot" cx="8" cy="21" r="3" />
            <text x="21" y="19" textAnchor="middle">PNG</text>
          </g>
        </svg>
      </div>
    );
  }
  if (variant === "doc") {
    return (
      <div className="ob-illustration is-playing" key={playKey}>
        <svg viewBox="0 0 260 168" className="il-doc" aria-hidden="true">
          <rect className="page" x="66" y="26" width="128" height="116" rx="8" />
          <rect className="line" x="84" y="48" width="92" height="7" rx="3.5" />
          <rect className="line" x="84" y="64" width="70" height="7" rx="3.5" />
          <rect className="flagbox" x="82" y="79" width="76" height="15" rx="4" />
          <rect className="line" x="84" y="103" width="60" height="7" rx="3.5" />
          <rect className="line" x="84" y="119" width="80" height="7" rx="3.5" />
          <g className="checkmark">
            <circle cx="178" cy="52" r="15" />
            <path d="M171 52 l5 5 10 -10" />
          </g>
        </svg>
      </div>
    );
  }
  return (
    <div className="ob-illustration is-playing" key={playKey}>
      <svg viewBox="0 0 260 168" className="il-pack" aria-hidden="true">
        <rect className="page p2" x="88" y="42" width="86" height="104" rx="7" />
        <rect className="page p1" x="88" y="42" width="86" height="104" rx="7" />
        <rect className="page p3" x="88" y="42" width="86" height="104" rx="7" />
        <rect className="spine" x="88" y="42" width="7" height="104" rx="3" />
        <g className="arrow" transform="translate(131,158)">
          <path d="M0 -14 v14 M-6 -3 l6 7 6 -7" stroke="#1d3c2d" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}

export function Onboarding({ onFinish }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"next" | "back">("next");
  const [playKey, setPlayKey] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step]!;

  function go(target: number, dir: "next" | "back") {
    setDirection(dir);
    setStep(Math.max(0, Math.min(STEPS.length - 1, target)));
    setPlayKey((key) => key + 1);
  }

  function handleNext() {
    if (isLast) {
      // Mirrors the mockup's ripple-then-advance timing: the confirmation ripple gets to play
      // out before the modal actually hands off, instead of the click visually doing nothing.
      setConfirming(true);
      window.setTimeout(onFinish, 420);
      return;
    }
    go(step + 1, "next");
  }

  return (
    <div className="ob-scrim" role="dialog" aria-modal="true" aria-label="Welcome to Tracepack">
      <div className="ob-card">
        {!isLast && (
          <button className="ob-skip" type="button" onClick={() => go(STEPS.length - 1, "next")}>
            Skip intro
          </button>
        )}

        <div className={`ob-panel${direction === "back" ? " dir-back" : ""}`}>
          {STEPS.map((content, index) => (
            <section key={index} className={`ob-step${index === step ? " is-active" : ""}`} data-step={index}>
              {index === step && <Illustration variant={content.illustration} playKey={playKey} />}
              <p className="ob-eyebrow">{content.eyebrow}</p>
              <h2 className="ob-head">{content.head}</h2>
              <p className="ob-body">{content.body}</p>
              {content.foot && <p className="ob-foot">{content.foot}</p>}
            </section>
          ))}
        </div>

        <div className="ob-controls">
          <div className="ob-dots">
            {STEPS.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Go to step ${index + 1} of ${STEPS.length}`}
                className={index === step ? "is-current" : index < step ? "is-done" : ""}
                onClick={() => go(index, index < step ? "back" : "next")}
              />
            ))}
          </div>
          <div className="ob-btns">
            <button className="ob-btn ghost" type="button" style={{ visibility: step === 0 ? "hidden" : "visible" }} onClick={() => go(step - 1, "back")}>
              Back
            </button>
            <button className={`ob-btn primary${confirming ? " is-confirming" : ""}`} type="button" onClick={handleNext}>
      <span className="btn-label">{isLast ? "Create your first pack" : "Next"}</span>
              <span className="ripple" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
