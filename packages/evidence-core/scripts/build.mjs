// See packages/evidence-sdk/scripts/build.mjs for why this bundles with esbuild rather than a
// per-file tsc emit: this package has zero runtime dependencies, so there's nothing to mark
// external either -- the output is fully self-contained.
import { build } from "esbuild";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows, a file:// URL's .pathname is
// "/C:/Users/.../src/index.ts" (a leading slash before the drive letter), which esbuild and
// Node's own path-handling reject as a filesystem path. fileURLToPath returns the real,
// platform-correct path on every OS -- this bit everyone who only ever tested on POSIX.
const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const outfile = fileURLToPath(new URL("../dist/index.js", import.meta.url));

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  sourcemap: true,
});

console.log("Built dist/index.js");
