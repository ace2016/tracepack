import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(
  new URL("../dist", import.meta.url)
);

const entry = fileURLToPath(
  new URL("../src/browser-global.ts", import.meta.url)
);

const outfile = fileURLToPath(
  new URL("../dist/browser.global.js", import.meta.url)
);

mkdirSync(distDir, {
  recursive: true,
});

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "TracePackIntegration",
  target: "es2022",
  minify: true,
  sourcemap: true,
});

console.log("Built dist/browser.global.js");
