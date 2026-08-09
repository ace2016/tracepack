// Bundles src/index.ts to a single dist/index.js with esbuild rather than a per-file tsc emit,
// so this package works from plain `node`/any bundler without every relative import in the
// source needing an explicit ".js" extension (the rest of this monorepo's packages are only
// ever consumed through a bundler that resolves extensionless specifiers itself -- this is the
// first package here meant to run outside that, so its build has to handle it, not its source).
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
  external: ["zod", "canonicalize"],
  sourcemap: true,
});

console.log("Built dist/index.js");
