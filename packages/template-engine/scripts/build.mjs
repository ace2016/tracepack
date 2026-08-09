// See packages/evidence-sdk/scripts/build.mjs for the general approach. @tracepack/evidence-core
// is marked external (not bundled) because it's a real published dependency in its own right,
// not an implementation detail of this package the way zod/yaml are treated as external too --
// both categories end up "external" here, but for different reasons: evidence-core because a
// consumer's own install of it should be the one in play, zod/yaml because bundling a full copy
// of a general-purpose library into every package that uses it is wasteful and error-prone.
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
  external: ["zod", "yaml", "@tracepack/evidence-core"],
  sourcemap: true,
});

console.log("Built dist/index.js");
