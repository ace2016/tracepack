// A clean-room tracepack-evidence v1 producer.
//
// Built ONLY from:
//   - packages/evidence-interchange/SPEC.md (the public design document, sections 6.1, 6.2, 8)
//   - packages/evidence-sdk/schema/tracepack-evidence.v1.json (the public JSON Schema)
//   - standard, independent npm libraries: json-canonicalize (an RFC 8785 implementation that
//     is NOT the `canonicalize` package Tracepack's own canonicalize.ts wraps), pdf-lib, and
//     Node's built-in crypto module.
//
// This file imports NOTHING from @tracepack/*. That is deliberate and load-bearing — it is
// what makes this a genuine test of whether the public interchange contract is implementable
// by a stranger, not a test of Tracepack's own code against itself. See
// tests/clean-room-integration.test.ts for the harness that feeds this producer's output to
// Tracepack's real importEvidencePayload() and proves it's accepted end to end.

import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { PDFDocument, StandardFonts } from "pdf-lib";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** A small, realistic receipt PDF. No PII, no dependency on Tracepack. */
export async function buildReceiptPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  const lines = [
    "Kitchen Gadgets Ltd",
    "Order #48213",
    "Espresso Grinder Pro - Qty 1",
    "Total: GBP 89.99",
    "Purchased: 2026-06-14",
  ];
  let y = 260;
  for (const line of lines) {
    page.drawText(line, { x: 24, y, size: 12, font });
    y -= 20;
  }
  return doc.save();
}

export interface CleanRoomPayload {
  payload: Record<string, unknown>;
  attachmentBytes: Uint8Array;
}

/**
 * Constructs a complete tracepack-evidence v1 payload for a warranty-support claim,
 * independently re-deriving SPEC.md's procedures rather than importing
 * packages/evidence-sdk/src/canonicalize.ts (or the earlier @tracepack/evidence-interchange
 * canonicalize.ts it moved from).
 */
export async function buildConsumerRightsHelperPayload(): Promise<CleanRoomPayload> {
  const attachmentBytes = await buildReceiptPdf();

  // SPEC.md section 6.1: content_hash is SHA-256 of the ORIGINAL BINARY bytes, computed
  // before base64 encoding — never of the base64 text.
  const contentHash = sha256Hex(attachmentBytes);
  const data = bytesToBase64(attachmentBytes);

  const envelope = {
    schema_version: 1 as const,
    source: {
      producer_id: "org.example.consumer-rights-helper",
      producer_name: "Consumer Rights Helper",
      producer_version: "1.0.0",
    },
    capture_timestamp: "2026-06-20T10:15:00Z",
    source_url: "https://consumerrightshelper.example/claims/8821",
    evidence_type: "warranty_claim_support",
    attachments: [
      {
        id: "receipt-1",
        filename: "receipt.pdf",
        mime_type: "application/pdf" as const,
        size: attachmentBytes.length,
        content_hash: contentHash,
        encoding: "base64" as const,
        data,
      },
    ],
    observations: [
      {
        id: "obs-warranty-1",
        kind: "warranty_period_active",
        label: "Purchase within 24-month warranty window",
        detail:
          "Order #48213 was placed on 2026-06-14. Kitchen Gadgets Ltd's published returns " +
          "policy states a 24-month manufacturer warranty on this product line, so a warranty " +
          "claim filed on this date falls inside that window.",
        confidence: 0.9,
        attachment_ref: "receipt-1",
      },
    ],
    integrity: {
      algorithm: "sha256" as const,
      canonicalization: "RFC8785" as const,
      payload_hash: "0".repeat(64), // placeholder, replaced below once the real hash is known
    },
  };

  // SPEC.md section 6.2: hash the RFC 8785 canonical form of the envelope with
  // attachments[].data removed and integrity.payload_hash removed — field-level exclusion,
  // not whole-object exclusion.
  const hashable = {
    ...envelope,
    attachments: envelope.attachments.map(({ data: _data, ...rest }) => rest),
    integrity: { algorithm: envelope.integrity.algorithm, canonicalization: envelope.integrity.canonicalization },
  };
  const canonical = canonicalize(hashable);
  const payloadHash = sha256Hex(new TextEncoder().encode(canonical));

  return {
    payload: { ...envelope, integrity: { ...envelope.integrity, payload_hash: payloadHash } },
    attachmentBytes,
  };
}
