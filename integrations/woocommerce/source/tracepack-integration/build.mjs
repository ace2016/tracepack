import { build } from "esbuild";
import { resolve } from "node:path";

const root = process.cwd();

await build({
  entryPoints: [
    resolve(root, "integration/src/browser-global.ts"),
  ],
  outfile: resolve(root, "dist/tracepack-integration.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "TracePackIntegration",
  target: "es2022",
  minify: true,
  sourcemap: true,
  alias: {
    "@tracepack/evidence-sdk": resolve(
      root,
      "evidence-sdk/src/index.ts",
    ),
  },
});

console.log("Built dist/tracepack-integration.js");
