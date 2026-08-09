// Unlike evidence-sdk/template-engine/evidence-core (libraries other packages depend on, where
// bundling a dependency would duplicate it across every consumer's install), this is a CLI:
// there's exactly one consumer per install, so bundling everything -- including
// @tracepack/template-engine, @tracepack/evidence-sdk, zod, yaml, canonicalize -- into one file
// is the friendlier shape. `npx @tracepack/cli` or a global install then needs no separate
// dependency resolution step to work.
import { build } from "esbuild";
import { chmodSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows, a file:// URL's .pathname is
// "/C:/Users/.../src/cli.ts" (a leading slash before the drive letter), which esbuild and
// Node's own path-handling reject as a filesystem path. fileURLToPath returns the real,
// platform-correct path on every OS -- this bit everyone who only ever tested on POSIX.
const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const entry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const outfile = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  // CJS, not ESM: the `yaml` dependency (via template-engine) has an internal CJS interop
  // shim that does a dynamic `require("process")` -- esbuild's ESM output has no `require`
  // available at runtime for that, and throws. CJS output sidesteps it entirely since Node
  // provides a real `require` natively there. This is a plain script entrypoint invoked via
  // `node dist/cli.js`, never imported as a module, so CJS has no downside here.
  format: "cjs",
  target: "es2022",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
});

chmodSync(outfile, 0o755);
console.log("Built dist/cli.js");
