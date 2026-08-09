import { useEffect, useRef, useState } from "react";

export interface OnboardingProps {
  onFinish: () => void;
}

// Deliberately a separate component from apps/website/src/Onboarding.tsx, not a shared one --
// that one is a marketing pitch aimed at a visitor deciding whether to try the product at all
// ("no account, no upload"). This one is a short orientation for someone who has already
// landed in the real, working app: three things worth knowing before they start, not a sales
// case for something they're already using. Content and tone differ on purpose; only the
// underlying colour tokens (--ink, --accent, --accent-ink, ...) are shared, because it's still
// the same product.

interface StepContent {
  eyebrow: string;
  head: string;
  body: string;
  icon: "device" | "review" | "edit";
}

const STEPS: StepContent[] = [
  {
    eyebrow: "Before you add anything",
    head: "This browser is where your pack lives.",
    body: "There's no account and nothing uploads on its own -- but that also means clearing your browser data removes it. Export a copy once you have what matters; it's the only real backup.",
    icon: "device",
  },
  {
    eyebrow: "Privacy review",
    head: "You decide what gets redacted, every time.",
    body: "Emails, phone numbers, and similar patterns get flagged automatically. Export stays open for unresolved findings, with a warning -- it never blocks you, but it also never removes anything without your say.",
    icon: "review",
  },
  {
    eyebrow: "Nothing here is final",
    head: "Move things, recategorise, add notes -- any time.",
    body: "A category marked \"required\" is a checklist, not a lock. Evidence can move between categories, notes can be added later, and the original file behind an item is never changed by any of it.",
    icon: "edit",
  },
];

function Icon({ variant }: { variant: StepContent["icon"] }) {
  if (variant === "device") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="ws-ob-icon">
        <rect x="9" y="6" width="30" height="36" rx="4" />
        <line x1="9" y1="34" x2="39" y2="34" />
        <circle cx="24" cy="38" r="1.6" />
      </svg>
    );
  }
  if (variant === "review") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="ws-ob-icon">
        <rect x="10" y="8" width="28" height="32" rx="3" />
        <line x1="16" y1="17" x2="32" y2="17" />
        <rect className="ws-ob-flag" x="15" y="23" width="18" height="6" rx="2" />
        <line x1="16" y1="34" x2="26" y2="34" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="ws-ob-icon">
      <rect x="8" y="10" width="22" height="28" rx="3" />
      <path d="M30 32 l8 -8 4 4 -8 8 -5 1 z" className="ws-ob-flag" />
    </svg>
  );
}

export function Onboarding({ onFinish }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step]!;
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open and back to whatever had it (the "Introduction" button
  // on replay, nothing in particular on a first visit) once this unmounts. App.tsx's own
  // navigation focus effect is guarded against showOnboarding for the same reason: on first
  // mount both would otherwise fire, and the parent's would win because it fires after this one.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  // A basic Tab trap: keep keyboard focus cycling among this dialog's own controls instead of
  // reaching workspace controls sitting behind the scrim. Recomputed on every Tab press rather
  // than cached, since Back only exists once step > 0.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="ws-ob-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Quick orientation"
      ref={dialogRef}
      tabIndex={-1}
    >
      <div className="ws-ob-card">
        <button className="ws-ob-skip" type="button" onClick={onFinish}>
          Skip
        </button>

        <Icon variant={current.icon} />
        <p className="ws-ob-eyebrow">{current.eyebrow}</p>
        <h2 className="ws-ob-head">{current.head}</h2>
        <p className="ws-ob-body">{current.body}</p>

        <div className="ws-ob-controls">
          <div className="ws-ob-dots">
            {STEPS.map((_, index) => (
              <span key={index} className={index === step ? "is-current" : index < step ? "is-done" : ""} />
            ))}
          </div>
          <div className="ws-ob-btns">
            {step > 0 && (
              <button className="btn btn-quiet" type="button" onClick={() => setStep((value) => value - 1)}>
                Back
              </button>
            )}
            <button className="btn btn-primary" type="button" onClick={() => (isLast ? onFinish() : setStep((value) => value + 1))}>
              {isLast ? "Get started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
