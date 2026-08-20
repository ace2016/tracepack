import { copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const source = resolve(repoRoot, "packages/integration/dist/browser.global.js");
const targetDirectory = resolve(here, "../assets");
const target = resolve(targetDirectory, "tracepack-integration.js");

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

console.log("Building @tracepack/integration browser bundle...");
await run("pnpm", ["--filter", "@tracepack/integration", "build:browser"]);

await mkdir(targetDirectory, { recursive: true });
await copyFile(source, target);

console.log(`Copied ${source} -> ${target}`);
