import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schema/tracepack-evidence.v1.json";
import { validateEvidencePayload } from "../src/validate";
import { base64ToBytes, canonicalizeJson, computePayloadHash, sha256Hex } from "../src/canonicalize";
import type { TracepackEvidencePayloadV1 } from "../src/types";

const VECTORS_DIR = fileURLToPath(new URL("../test-vectors", import.meta.url));

// This file proves packages/evidence-sdk/test-vectors/ -- the language-agnostic interop
// contract a non-TypeScript implementer builds against -- is actually kept true by this
// package's own code, not just documentation that could silently drift. See the README in
// that directory for what each vector means and how an independent implementation checks
// itself against the same files.

describe("content-hash test vectors", () => {
  const files = readdirSync(`${VECTORS_DIR}/content-hash`).filter((f) => f.endsWith(".json"));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    it(`${file} reproduces via base64-decode then sha256, not by hashing the base64 text`, async () => {
      const vector = JSON.parse(readFileSync(`${VECTORS_DIR}/content-hash/${file}`, "utf-8"));
      const decoded = base64ToBytes(vector.content_base64);
      expect(decoded.length).toBe(vector.byte_length);
      expect(await sha256Hex(decoded)).toBe(vector.content_hash_sha256_hex);

      // The bug the vector exists to catch: hashing the base64 text itself must NOT match.
      const wrongHash = await sha256Hex(vector.content_base64);
      expect(wrongHash).not.toBe(vector.content_hash_sha256_hex);
    });
  }
});

describe("payload-hash test vectors", () => {
  const files = readdirSync(`${VECTORS_DIR}/payload-hash`).filter((f) => f.endsWith(".json"));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    it(`${file} reproduces via RFC 8785 canonicalization independently, and via computePayloadHash`, async () => {
      const vector = JSON.parse(readFileSync(`${VECTORS_DIR}/payload-hash/${file}`, "utf-8"));
      const payload = vector.input_payload as TracepackEvidencePayloadV1;

      // Independent reconstruction of the exclusion rule (SPEC.md section 6.2), built here
      // rather than by calling computePayloadHash, so this test does not just check the
      // production function against itself.
      const attachmentsWithoutBytes = payload.attachments.map(({ data: _data, ...rest }) => rest);
      const hashable = {
        ...payload,
        attachments: attachmentsWithoutBytes,
        integrity: { algorithm: payload.integrity.algorithm, canonicalization: payload.integrity.canonicalization },
      };
      const canonical = canonicalizeJson(hashable);
      expect(canonical).toBe(vector.canonical_form_excluding_hash);
      expect(await sha256Hex(canonical)).toBe(vector.payload_hash_sha256_hex);

      // The actual production function must agree with the independent reconstruction above.
      expect(await computePayloadHash(payload)).toBe(vector.payload_hash_sha256_hex);
      // The vector's own embedded payload_hash must be internally self-consistent too.
      expect(payload.integrity.payload_hash).toBe(vector.payload_hash_sha256_hex);
    });
  }
});

describe("validation test vectors", () => {
  const ajv = new Ajv2020({ strict: true, formats: { "date-time": true, uri: true } });
  const validateAgainstJsonSchema = ajv.compile(schema);

  const manifest = JSON.parse(readFileSync(`${VECTORS_DIR}/validation/manifest.json`, "utf-8")) as {
    vectors: { file: string; expected_valid: boolean; json_schema_alone_sufficient: boolean; description: string }[];
  };
  expect(manifest.vectors.length).toBeGreaterThan(0);

  const filesOnDisk = readdirSync(`${VECTORS_DIR}/validation`).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  it("manifest.json lists exactly the vector files present on disk", () => {
    expect(manifest.vectors.map((v) => v.file).sort()).toEqual(filesOnDisk.sort());
  });

  for (const entry of manifest.vectors) {
    it(`${entry.file}: ${entry.description}`, () => {
      const vector = JSON.parse(readFileSync(`${VECTORS_DIR}/validation/${entry.file}`, "utf-8"));
      expect(vector.expected_valid).toBe(entry.expected_valid);

      const zodResult = validateEvidencePayload(vector.payload);
      expect(zodResult.ok).toBe(vector.expected_valid);
      expect(vector.json_schema_alone_sufficient).toBe(entry.json_schema_alone_sufficient);

      if (vector.json_schema_alone_sufficient) {
        // For purely structural rules, the JSON Schema mirror must reach the same
        // accept/reject decision -- this is the check that would catch the schema and the
        // reference validator silently drifting apart.
        expect(validateAgainstJsonSchema(vector.payload)).toBe(vector.expected_valid);
      } else {
        // Pinned, not just skipped: this is a known, documented gap (SPEC.md section 10) --
        // a semantic/cross-field rule the plain JSON Schema vocabulary cannot express, so the
        // schema alone still ACCEPTS a payload the full contract rejects. If a future change
        // to the schema (e.g. a custom keyword) closes this gap, this assertion should flip
        // to `false` and json_schema_alone_sufficient should become `true` for that vector.
        expect(validateAgainstJsonSchema(vector.payload)).toBe(true);
      }
    });
  }
});
