import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(
  new URL("../dist", import.meta.url),
);
const entry = fileURLToPath(
  new URL("../src/index.ts", import.meta.url),
);
const outfile = fileURLToPath(
  new URL("../dist/index.js", import.meta.url),
);

rmSync(distDir, {
  recursive: true,
  force: true,
});
mkdirSync(distDir, {
  recursive: true,
});

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  external: [
    "@tracepack/attestation",
    "@tracepack/evidence-core",
  ],
  sourcemap: true,
});

console.log(
  "Built @tracepack/pack-attestation",
);
