import { describe, expect, it } from "vitest";

import {
  TRACEPACK_HANDOFF_PROTOCOL_VERSION,
  isTracepackAcceptedMessage,
  isTracepackImportedMessage,
  isTracepackReadyMessage,
  isTracepackRejectedMessage,
  isTracepackSendMessage,
} from "../src/protocol";

describe("TracePack handoff protocol", () => {
  it("recognises a valid ready message", () => {
    expect(
      isTracepackReadyMessage({
        source: "tracepack",
        type: "ready",
        protocol_version: TRACEPACK_HANDOFF_PROTOCOL_VERSION,
      })
    ).toBe(true);
  });

  it("rejects a ready message using another protocol version", () => {
    expect(
      isTracepackReadyMessage({
        source: "tracepack",
        type: "ready",
        protocol_version: 2,
      })
    ).toBe(false);
  });

  it("recognises a structurally valid send message", () => {
    expect(
      isTracepackSendMessage({
        source: "tracepack-producer",
        type: "send",
        protocol_version: 1,
        handoff_id: "handoff-123",
        handoff: {},
      })
    ).toBe(true);
  });

  it("rejects a send message without a handoff id", () => {
    expect(
      isTracepackSendMessage({
        source: "tracepack-producer",
        type: "send",
        protocol_version: 1,
        handoff: {},
      })
    ).toBe(false);
  });

  it("recognises an accepted response", () => {
    expect(
      isTracepackAcceptedMessage({
        source: "tracepack",
        type: "accepted",
        protocol_version: 1,
        handoff_id: "handoff-123",
      })
    ).toBe(true);
  });

  it("recognises a rejected response", () => {
    expect(
      isTracepackRejectedMessage({
        source: "tracepack",
        type: "rejected",
        protocol_version: 1,
        handoff_id: "handoff-123",
        issues: [
          {
            code: "INVALID_EVIDENCE",
            message: "Evidence payload is invalid.",
          },
        ],
      })
    ).toBe(true);
  });

  it("recognises an imported response", () => {
    expect(
      isTracepackImportedMessage({
        source: "tracepack",
        type: "imported",
        protocol_version: 1,
        handoff_id: "handoff-123",
        project_id: "project-456",
        evidence_count: 3,
      })
    ).toBe(true);
  });

  it("ignores unrelated postMessage traffic", () => {
    expect(
      isTracepackSendMessage({
        source: "some-other-library",
        type: "send",
        protocol_version: 1,
        handoff_id: "handoff-123",
        handoff: {},
      })
    ).toBe(false);
  });
});

describe("TracePack protocol message builders", () => {
  it("creates a versioned ready message", async () => {
    const { createTracepackReadyMessage } = await import("../src/protocol");

    expect(createTracepackReadyMessage()).toEqual({
      source: "tracepack",
      type: "ready",
      protocol_version: 1,
    });
  });

  it("creates an accepted response tied to its handoff", async () => {
    const { createTracepackAcceptedMessage } = await import("../src/protocol");

    expect(createTracepackAcceptedMessage("handoff-1")).toEqual({
      source: "tracepack",
      type: "accepted",
      protocol_version: 1,
      handoff_id: "handoff-1",
    });
  });

  it("creates an imported response tied to its handoff and project", async () => {
    const { createTracepackImportedMessage } = await import("../src/protocol");

    expect(
      createTracepackImportedMessage("handoff-1", "project-1", 3)
    ).toEqual({
      source: "tracepack",
      type: "imported",
      protocol_version: 1,
      handoff_id: "handoff-1",
      project_id: "project-1",
      evidence_count: 3,
    });
  });
});

it("recognises a cancelled response", async () => {
  const { isTracepackCancelledMessage } = await import("../src/protocol");

  expect(
    isTracepackCancelledMessage({
      source: "tracepack",
      type: "cancelled",
      protocol_version: 1,
      handoff_id: "handoff-123",
    })
  ).toBe(true);
});
