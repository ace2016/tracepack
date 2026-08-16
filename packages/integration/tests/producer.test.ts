import { describe, expect, it } from "vitest";

import {
  createTracepackHandoff,
  createTracepackSendMessage,
} from "../src";

const HASH = "0".repeat(64);

function evidencePayload() {
  return {
    schema_version: 1 as const,
    source: {
      producer_id: "org.example.support",
      producer_name: "Example Support",
      producer_version: "2.1.0",
    },
    capture_timestamp: "2026-08-13T09:00:00Z",
    evidence_type: "support_conversation",
    attachments: [],
    observations: [],
    integrity: {
      algorithm: "sha256" as const,
      canonicalization: "RFC8785" as const,
      payload_hash: HASH,
    },
  };
}

describe("TracePack producer helpers", () => {
  it("derives producer identity from evidence provenance", () => {
    const handoff = createTracepackHandoff({
      evidencePayload: evidencePayload(),
      context: {
        purpose: "support_case",
        reference: "Conversation #123",
      },
    });

    expect(handoff.producer).toEqual({
      id: "org.example.support",
      name: "Example Support",
      version: "2.1.0",
    });

    expect(handoff.context?.reference).toBe(
      "Conversation #123"
    );
  });

  it("does not require a TracePack template id", () => {
    const handoff = createTracepackHandoff({
      evidencePayload: evidencePayload(),
      context: {
        purpose: "support_case",
      },
    });

    expect(handoff.template).toBeUndefined();
  });

  it("creates a correlated protocol-v1 send message", () => {
    const handoff = createTracepackHandoff({
      evidencePayload: evidencePayload(),
    });

    const message = createTracepackSendMessage(
      "handoff-123",
      handoff
    );

    expect(message).toEqual(
      expect.objectContaining({
        source: "tracepack-producer",
        type: "send",
        protocol_version: 1,
        handoff_id: "handoff-123",
      })
    );

    expect(message.handoff).toBe(handoff);
  });
});
