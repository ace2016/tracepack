import { describe, expect, it, vi } from "vitest";

import {
  createTracepackHandoff,
  startTracepackBrowserHandoff,
  type TracepackBrowserEnvironment,
  type TracepackBrowserMessageEvent,
  type TracepackOpenedWindow,
} from "../src";

const HASH = "0".repeat(64);

function handoff() {
  return createTracepackHandoff({
    evidencePayload: {
      schema_version: 1,
      source: {
        producer_id: "org.example.support",
        producer_name: "Example Support",
      },
      capture_timestamp: "2026-08-13T09:00:00Z",
      evidence_type: "support_conversation",
      attachments: [],
      observations: [],
      integrity: {
        algorithm: "sha256",
        canonicalization: "RFC8785",
        payload_hash: HASH,
      },
    },
    context: {
      purpose: "support_case",
    },
  });
}

function fakeBrowser() {
  let listener:
    | ((event: TracepackBrowserMessageEvent) => void)
    | undefined;

  const posted: Array<{
    message: unknown;
    origin: string;
  }> = [];

  const navigated: string[] = [];

  const target: TracepackOpenedWindow = {
    closed: false,
    postMessage(message, origin) {
      posted.push({ message, origin });
    },
  };

  const environment: TracepackBrowserEnvironment = {
    open: vi.fn(() => target),

    navigate(targetWindow, url) {
      expect(targetWindow).toBe(target);
      navigated.push(url);
    },

    addMessageListener(next) {
      listener = next;
    },

    removeMessageListener(next) {
      if (listener === next) listener = undefined;
    },

    setTimer(callback, milliseconds) {
      return setTimeout(callback, milliseconds);
    },

    clearTimer(timer) {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    },

    randomUUID() {
      return "generated-handoff-id";
    },
  };

  function emit(
    data: unknown,
    origin = "https://app.tracepack.org",
    source: unknown = target
  ) {
    listener?.({
      data,
      origin,
      source,
    });
  }

  return {
    environment,
    target,
    posted,
    navigated,
    emit,
  };
}

describe("TracePack browser handoff", () => {
  it("sends protocol v1 only after TracePack reports ready", () => {
    const browser = fakeBrowser();

    startTracepackBrowserHandoff({
      tracepackUrl: "https://app.tracepack.org",
      handoff: handoff(),
      handoffId: "handoff-1",
      environment: browser.environment,
    });

    expect(browser.posted).toHaveLength(0);

    browser.emit({
      source: "tracepack",
      type: "ready",
      protocol_version: 1,
    });

    expect(browser.posted).toHaveLength(1);

    expect(browser.posted[0]?.origin).toBe(
      "https://app.tracepack.org"
    );

    expect(browser.posted[0]?.message).toEqual(
      expect.objectContaining({
        source: "tracepack-producer",
        type: "send",
        protocol_version: 1,
        handoff_id: "handoff-1",
      })
    );
  });

  it("rejects an empty caller-supplied handoff id immediately", () => {
    const browser = fakeBrowser();

    expect(() =>
      startTracepackBrowserHandoff({
        tracepackUrl: "https://app.tracepack.org",
        handoff: handoff(),
        handoffId: "   ",
        environment: browser.environment,
      })
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_HANDOFF",
      })
    );

    expect(browser.environment.open).not.toHaveBeenCalled();
    expect(browser.posted).toHaveLength(0);
  });

  it("ignores messages from another origin or window", () => {
    const browser = fakeBrowser();

    startTracepackBrowserHandoff({
      tracepackUrl: "https://app.tracepack.org",
      handoff: handoff(),
      environment: browser.environment,
    });

    browser.emit(
      {
        source: "tracepack",
        type: "ready",
        protocol_version: 1,
      },
      "https://attacker.example"
    );

    browser.emit(
      {
        source: "tracepack",
        type: "ready",
        protocol_version: 1,
      },
      "https://app.tracepack.org",
      {}
    );

    expect(browser.posted).toHaveLength(0);
  });

  it("correlates accepted and imported responses by handoff id", async () => {
    const browser = fakeBrowser();
    const statuses: string[] = [];

    const session = startTracepackBrowserHandoff({
      tracepackUrl: "https://app.tracepack.org",
      handoff: handoff(),
      handoffId: "handoff-1",
      environment: browser.environment,
      onStatus(message) {
        statuses.push(message.type);
      },
    });

    browser.emit({
      source: "tracepack",
      type: "accepted",
      protocol_version: 1,
      handoff_id: "someone-else",
    });

    browser.emit({
      source: "tracepack",
      type: "accepted",
      protocol_version: 1,
      handoff_id: "handoff-1",
    });

    browser.emit({
      source: "tracepack",
      type: "imported",
      protocol_version: 1,
      handoff_id: "handoff-1",
      project_id: "project-123",
      evidence_count: 4,
    });

    await expect(session.completion).resolves.toEqual(
      expect.objectContaining({
        handoff_id: "handoff-1",
        project_id: "project-123",
        evidence_count: 4,
      })
    );

    expect(statuses).toEqual([
      "accepted",
      "imported",
    ]);
  });

  it("rejects completion if the receiver closes after acceptance", async () => {
    const browser = fakeBrowser();

    const session = startTracepackBrowserHandoff({
      tracepackUrl: "https://app.tracepack.org",
      handoff: handoff(),
      handoffId: "handoff-closed",
      environment: browser.environment,
      receiverClosedPollMs: 5,
    });

    browser.emit({
      source: "tracepack",
      type: "accepted",
      protocol_version: 1,
      handoff_id: "handoff-closed",
    });

    browser.target.closed = true;

    await expect(session.completion).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });

  it("times out an accepted handoff if the receiver stays open but never completes", async () => {
    const browser = fakeBrowser();

    const session = startTracepackBrowserHandoff({
      tracepackUrl: "https://app.tracepack.org",
      handoff: handoff(),
      handoffId: "handoff-reloaded",
      environment: browser.environment,
      receiverClosedPollMs: 1000,
      completionTimeoutMs: 5,
    });

    browser.emit({
      source: "tracepack",
      type: "accepted",
      protocol_version: 1,
      handoff_id: "handoff-reloaded",
    });

    expect(browser.target.closed).toBe(false);

    await expect(session.completion).rejects.toMatchObject({
      code: "TIMED_OUT",
    });
  });

  it("surfaces a correlated rejection", async () => {
    const browser = fakeBrowser();

    const session = startTracepackBrowserHandoff({
      tracepackUrl: "https://app.tracepack.org",
      handoff: handoff(),
      handoffId: "handoff-rejected",
      environment: browser.environment,
    });

    const completion = expect(
      session.completion
    ).rejects.toMatchObject({
      code: "REJECTED",
    });

    browser.emit({
      source: "tracepack",
      type: "rejected",
      protocol_version: 1,
      handoff_id: "handoff-rejected",
      issues: [
        {
          code: "INVALID_EVIDENCE",
          message: "Evidence is invalid.",
        },
      ],
    });

    await completion;
  });

  it("times out if TracePack never accepts the handoff", async () => {
    const browser = fakeBrowser();

    const session = startTracepackBrowserHandoff({
      tracepackUrl: "https://app.tracepack.org",
      handoff: handoff(),
      environment: browser.environment,
      handshakeTimeoutMs: 5,
    });

    await expect(session.completion).rejects.toMatchObject({
      code: "TIMED_OUT",
    });
  });
});

it("uses a pre-opened window and navigates it after the listener is installed", () => {
  const browser = fakeBrowser();

  startTracepackBrowserHandoff({
    tracepackUrl: "https://app.tracepack.org",
    handoff: handoff(),
    handoffId: "handoff-preopened",
    environment: browser.environment,
    targetWindow: browser.target,
  });

  expect(browser.environment.open).not.toHaveBeenCalled();

  expect(browser.navigated).toHaveLength(1);
  expect(browser.navigated[0]).toContain(
    "https://app.tracepack.org/"
  );
  expect(browser.navigated[0]).toContain(
    "send-to-tracepack=1"
  );

  browser.emit({
    source: "tracepack",
    type: "ready",
    protocol_version: 1,
  });

  expect(browser.posted).toHaveLength(1);

  expect(browser.posted[0]?.message).toEqual(
    expect.objectContaining({
      type: "send",
      handoff_id: "handoff-preopened",
    })
  );
});
