import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(
  new URL("../dist", import.meta.url),
);

rmSync(distDir, {
  recursive: true,
  force: true,
});

mkdirSync(distDir, {
  recursive: true,
});

await build({
  entryPoints: {
    index: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    browser: fileURLToPath(new URL("../src/browser.ts", import.meta.url)),
  },
  outdir: distDir,
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  external: ["@tracepack/evidence-sdk"],
});

await build({
  entryPoints: [
    fileURLToPath(new URL("../src/browser-global.ts", import.meta.url)),
  ],
  outfile: fileURLToPath(
    new URL("../dist/browser.global.js", import.meta.url),
  ),
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "TracePackIntegration",
  target: "es2022",
  minify: true,
  sourcemap: true,
});

console.log("Built @tracepack/integration");
