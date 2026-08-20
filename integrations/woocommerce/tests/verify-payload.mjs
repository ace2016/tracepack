import { computePayloadHash, validateEvidencePayload } from "../../../packages/evidence-sdk/dist/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(dir, "fixture-payload.json");

if (!fs.existsSync(fixturePath)) {
  console.error("fixture-payload.json is missing. Run: php integrations/woocommerce/tests/test-payload-builder.php");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const result = validateEvidencePayload(payload);

if (!result.ok) {
  console.error("Schema validation FAILED:", JSON.stringify(result.issues, null, 2));
  process.exit(1);
}

console.log("Schema validation: ok");

const recomputed = await computePayloadHash(payload);

if (recomputed !== payload.integrity.payload_hash) {
  console.error(
    `Hash mismatch. PHP computed ${payload.integrity.payload_hash}, TypeScript recomputed ${recomputed}`
  );
  process.exit(1);
}

console.log("payload_hash matches @tracepack/evidence-sdk:", recomputed);
console.log("ALL CHECKS PASSED");
