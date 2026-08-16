import { validateTracepackHandoff } from "./handoff";
import {
  createTracepackSendMessage,
  isTracepackAcceptedMessage,
  isTracepackCancelledMessage,
  isTracepackImportedMessage,
  isTracepackReadyMessage,
  isTracepackRejectedMessage,
  type TracepackAcceptedMessage,
  type TracepackCancelledMessage,
  type TracepackHandoffV1,
  type TracepackImportedMessage,
  type TracepackRejectedMessage,
} from "./protocol";

export interface TracepackOpenedWindow {
  postMessage(message: unknown, targetOrigin: string): void;
  closed?: boolean;
}

export interface TracepackBrowserMessageEvent {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface TracepackBrowserEnvironment {
  open(url: string): TracepackOpenedWindow | null;
  navigate(
    target: TracepackOpenedWindow,
    url: string
  ): void;
  addMessageListener(
    listener: (event: TracepackBrowserMessageEvent) => void
  ): void;
  removeMessageListener(
    listener: (event: TracepackBrowserMessageEvent) => void
  ): void;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(timer: unknown): void;
  randomUUID(): string;
}

export type TracepackBrowserStatusMessage =
  | TracepackAcceptedMessage
  | TracepackRejectedMessage
  | TracepackCancelledMessage
  | TracepackImportedMessage;

export type TracepackBrowserHandoffErrorCode =
  | "INVALID_TARGET"
  | "INVALID_HANDOFF"
  | "POPUP_BLOCKED"
  | "TIMED_OUT"
  | "REJECTED"
  | "CANCELLED";

export class TracepackBrowserHandoffError extends Error {
  constructor(
    public readonly code: TracepackBrowserHandoffErrorCode,
    message: string,
    public readonly response?:
      | TracepackRejectedMessage
      | TracepackCancelledMessage
  ) {
    super(message);
    this.name = "TracepackBrowserHandoffError";
  }
}

export interface StartTracepackBrowserHandoffOptions {
  tracepackUrl: string;
  handoff: TracepackHandoffV1;
  handoffId?: string;
  handshakeTimeoutMs?: number;
  receiverClosedPollMs?: number;
  completionTimeoutMs?: number;
  environment?: TracepackBrowserEnvironment;
  targetWindow?: TracepackOpenedWindow;
  onStatus?: (message: TracepackBrowserStatusMessage) => void;
}

export interface TracepackBrowserHandoffSession {
  handoffId: string;
  targetOrigin: string;
  completion: Promise<TracepackImportedMessage>;
  dispose(): void;
}

function defaultBrowserEnvironment(): TracepackBrowserEnvironment {
  if (typeof window === "undefined") {
    throw new Error(
      "TracePack browser handoff requires a browser environment."
    );
  }

  return {
    open(url) {
      return window.open(url, "_blank");
    },

    navigate(target, url) {
      (target as Window).location.href = url;
    },

    addMessageListener(listener) {
      window.addEventListener(
        "message",
        listener as (event: MessageEvent) => void
      );
    },

    removeMessageListener(listener) {
      window.removeEventListener(
        "message",
        listener as (event: MessageEvent) => void
      );
    },

    setTimer(callback, milliseconds) {
      return window.setTimeout(callback, milliseconds);
    },

    clearTimer(timer) {
      window.clearTimeout(timer as number);
    },

    randomUUID() {
      return crypto.randomUUID();
    },
  };
}

export function startTracepackBrowserHandoff(
  options: StartTracepackBrowserHandoffOptions
): TracepackBrowserHandoffSession {
  const validation = validateTracepackHandoff(options.handoff);

  if (!validation.ok) {
    throw new TracepackBrowserHandoffError(
      "INVALID_HANDOFF",
      validation.issues
        .map(
          (issue) =>
            `${issue.path || "root"}: ${issue.message}`
        )
        .join("; ")
    );
  }

  let targetUrl: URL;

  try {
    targetUrl = new URL(options.tracepackUrl);
  } catch {
    throw new TracepackBrowserHandoffError(
      "INVALID_TARGET",
      "TracePack target must be a valid URL."
    );
  }

  if (
    targetUrl.protocol !== "https:" &&
    targetUrl.protocol !== "http:"
  ) {
    throw new TracepackBrowserHandoffError(
      "INVALID_TARGET",
      "TracePack target must use http or https."
    );
  }

  targetUrl.searchParams.set("send-to-tracepack", "1");

  const targetOrigin = targetUrl.origin;
  const environment =
    options.environment ?? defaultBrowserEnvironment();

  if (
    options.handoffId !== undefined &&
    options.handoffId.trim().length === 0
  ) {
    throw new TracepackBrowserHandoffError(
      "INVALID_HANDOFF",
      "TracePack handoff ID must not be empty."
    );
  }

  const handoffId =
    options.handoffId ?? environment.randomUUID();

  // Give every browser handoff a unique navigation URL.
  // This avoids mobile browsers restoring a previous TracePack receiver
  // document instead of loading a fresh handoff session.
  targetUrl.searchParams.set("handoff", handoffId);

  const suppliedWindow = options.targetWindow;

  const openedWindow =
    suppliedWindow ??
    environment.open(targetUrl.toString());

  if (!openedWindow) {
    throw new TracepackBrowserHandoffError(
      "POPUP_BLOCKED",
      "The TracePack window could not be opened."
    );
  }

  const targetWindow: TracepackOpenedWindow = openedWindow;

  const sendMessage = createTracepackSendMessage(
    handoffId,
    validation.handoff
  );

  let sent = false;
  let settled = false;
  let timer: unknown;
  let completionTimer: unknown;

  let resolveCompletion!: (
    message: TracepackImportedMessage
  ) => void;

  let rejectCompletion!: (
    error: TracepackBrowserHandoffError
  ) => void;

  const completion = new Promise<TracepackImportedMessage>(
    (resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    }
  );

  function cleanup() {
    environment.removeMessageListener(handleMessage);

    if (timer !== undefined) {
      environment.clearTimer(timer);
      timer = undefined;
    }

    if (completionTimer !== undefined) {
      environment.clearTimer(completionTimer);
      completionTimer = undefined;
    }
  }

  function reject(
    error: TracepackBrowserHandoffError
  ) {
    if (settled) return;

    settled = true;
    cleanup();
    rejectCompletion(error);
  }

  function resolve(
    message: TracepackImportedMessage
  ) {
    if (settled) return;

    settled = true;
    cleanup();
    resolveCompletion(message);
  }

  function watchForReceiverClosure() {
    if (settled) return;

    if (targetWindow.closed === true) {
      reject(
        new TracepackBrowserHandoffError(
          "CANCELLED",
          "The TracePack window was closed before the handoff completed."
        )
      );
      return;
    }

    timer = environment.setTimer(
      watchForReceiverClosure,
      options.receiverClosedPollMs ?? 500
    );
  }

  function handleMessage(
    event: TracepackBrowserMessageEvent
  ) {
    // A producer only trusts messages from the exact TracePack origin
    // and the exact window it opened.
    if (
      event.origin !== targetOrigin ||
      event.source !== targetWindow
    ) {
      return;
    }

    if (isTracepackReadyMessage(event.data)) {
      if (sent) return;

      sent = true;

      targetWindow.postMessage(
        sendMessage,
        targetOrigin
      );

      return;
    }

    if (
      isTracepackAcceptedMessage(event.data) &&
      event.data.handoff_id === handoffId
    ) {
      if (timer !== undefined) {
        environment.clearTimer(timer);
        timer = undefined;
      }

      options.onStatus?.(event.data);

      // Acceptance ends only the handshake phase. The session remains active
      // until imported, rejected or cancelled. Window-closure polling covers a
      // closed tab, while this independent lifecycle timeout also covers reload
      // or navigation of a still-open receiver that loses its in-memory handoff.
      completionTimer = environment.setTimer(
        () => {
          reject(
            new TracepackBrowserHandoffError(
              "TIMED_OUT",
              "The TracePack handoff did not complete before the receiver lifecycle timeout."
            )
          );
        },
        options.completionTimeoutMs ?? 30 * 60 * 1000
      );

      watchForReceiverClosure();
      return;
    }

    if (
      isTracepackRejectedMessage(event.data) &&
      event.data.handoff_id === handoffId
    ) {
      options.onStatus?.(event.data);

      reject(
        new TracepackBrowserHandoffError(
          "REJECTED",
          event.data.issues[0]?.message ??
            "TracePack rejected the handoff.",
          event.data
        )
      );

      return;
    }

    if (
      isTracepackCancelledMessage(event.data) &&
      event.data.handoff_id === handoffId
    ) {
      options.onStatus?.(event.data);

      reject(
        new TracepackBrowserHandoffError(
          "CANCELLED",
          "The TracePack handoff was cancelled.",
          event.data
        )
      );

      return;
    }

    if (
      isTracepackImportedMessage(event.data) &&
      event.data.handoff_id === handoffId
    ) {
      options.onStatus?.(event.data);
      resolve(event.data);
    }
  }

  environment.addMessageListener(handleMessage);

  timer = environment.setTimer(() => {
    reject(
      new TracepackBrowserHandoffError(
        "TIMED_OUT",
        "TracePack did not accept the handoff before the handshake timeout."
      )
    );
  }, options.handshakeTimeoutMs ?? 30_000);

  // A producer may open about:blank synchronously inside the user's click
  // gesture, then supply that window after asynchronous evidence preparation.
  // Install the listener first so TracePack cannot emit ready before we listen.
  if (suppliedWindow) {
    environment.navigate(
      targetWindow,
      targetUrl.toString()
    );
  }

  return {
    handoffId,
    targetOrigin,
    completion,

    dispose() {
      if (settled) return;

      reject(
        new TracepackBrowserHandoffError(
          "CANCELLED",
          "The browser handoff session was disposed."
        )
      );
    },
  };
}
