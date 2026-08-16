import { describe, expect, it } from "vitest";

import { validateTracepackHandoff } from "../src/handoff";

const HASH = "0".repeat(64);

function evidencePayload() {
  return {
    schema_version: 1,
    source: {
      producer_id: "com.example.product",
      producer_name: "Example Product",
      producer_version: "1.0.0",
    },
    capture_timestamp: "2026-08-13T08:00:00Z",
    evidence_type: "support_conversation",
    attachments: [],
    observations: [],
    integrity: {
      algorithm: "sha256",
      canonicalization: "RFC8785",
      payload_hash: HASH,
    },
  };
}

function validHandoff() {
  return {
    protocol_version: 1,
    producer: {
      id: "com.example.product",
      name: "Example Product",
      version: "1.0.0",
    },
    evidence_payload: evidencePayload(),
    context: {
      purpose: "consumer_dispute",
      reference: "CASE-123",
    },
    template: {
      mode: "recommend",
    },
  };
}

describe("TracePack handoff validation", () => {
  it("accepts a valid handoff envelope", () => {
    const result = validateTracepackHandoff(validHandoff());

    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported protocol version", () => {
    const handoff = validHandoff();
    handoff.protocol_version = 2;

    const result = validateTracepackHandoff(handoff);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "UNSUPPORTED_PROTOCOL",
          path: "protocol_version",
        })
      );
    }
  });

  it("rejects missing producer identity", () => {
    const handoff = validHandoff();
    handoff.producer.id = "";

    const result = validateTracepackHandoff(handoff);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "INVALID_HANDOFF",
          path: "producer.id",
        })
      );
    }
  });

  it("rejects an invalid nested evidence payload", () => {
    const handoff = validHandoff();
    handoff.evidence_payload.evidence_type = "";

    const result = validateTracepackHandoff(handoff);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "INVALID_EVIDENCE",
          path: "evidence_payload.evidence_type",
        })
      );
    }
  });

  it("rejects producer identity that disagrees with evidence provenance", () => {
    const handoff = validHandoff();
    handoff.producer.id = "com.someone.else";

    const result = validateTracepackHandoff(handoff);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "INVALID_HANDOFF",
          path: "producer.id",
        })
      );
    }
  });

  it("requires a template id when suggesting a template", () => {
    const handoff = validHandoff();
    handoff.template = {
      mode: "suggest",
    };

    const result = validateTracepackHandoff(handoff);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          path: "template.template_id",
        })
      );
    }
  });

  it("allows recommendation without exposing a TracePack template id", () => {
    const handoff = validHandoff();
    handoff.template = {
      mode: "recommend",
    };

    const result = validateTracepackHandoff(handoff);

    expect(result.ok).toBe(true);
  });
});
