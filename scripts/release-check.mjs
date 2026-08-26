import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packages = [
  "evidence-core",
  "template-engine",
  "evidence-sdk",
  "integration",
  "cli",
  "attestation",
  "attestation-sigstore",
  "pack-attestation",
];
const releaseTag = process.env.TRACEPACK_RELEASE_TAG;
const releaseTagMatch = releaseTag?.match(
  /^developer-v(\d+\.\d+\.\d+)$/,
);

if (releaseTag && !releaseTagMatch) {
  fail(`release tag ${releaseTag} must use the stable form developer-vX.Y.Z`);
}

const expectedVersion = releaseTagMatch?.[1] ?? JSON.parse(
  readFileSync(join(root, "packages", "evidence-core", "package.json"), "utf8"),
).version;

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function pnpm(args, cwd = root) {
  const cli = process.env.npm_execpath;
  if (!cli) fail("pnpm did not provide npm_execpath");
  run(process.execPath, [cli, ...args], cwd);
}

function fail(message) {
  throw new Error(`Release check failed: ${message}`);
}

const releaseDir = mkdtempSync(join(tmpdir(), "tracepack-release-check-"));

try {
  for (const folder of packages) {
    const manifestPath = join(root, "packages", folder, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const expectedName = `@tracepack/${folder}`;

    if (manifest.name !== expectedName) fail(`${folder} has unexpected name ${manifest.name}`);
    if (manifest.version !== expectedVersion) {
      fail(`${manifest.name} version ${manifest.version} does not match ${expectedVersion}`);
    }
    if (manifest.private === true) fail(`${manifest.name} is marked private`);
    if (manifest.license !== "Apache-2.0") fail(`${manifest.name} is not Apache-2.0`);
    if (manifest.publishConfig?.access !== "public") fail(`${manifest.name} is not configured for public access`);
    if (manifest.publishConfig?.provenance !== true) fail(`${manifest.name} does not require npm provenance`);
    if (manifest.repository?.url !== "git+https://github.com/ace2016/tracepack.git") {
      fail(`${manifest.name} does not point at the public source repository`);
    }
    if (!manifest.homepage || !manifest.bugs?.url) fail(`${manifest.name} is missing public support links`);
  }

  const internalPackages = [
    "document-engine",
    "evidence-interchange",
    "export-engine",
    "storage",
  ];

  for (const folder of internalPackages) {
    const manifest = JSON.parse(
      readFileSync(
        join(root, "packages", folder, "package.json"),
        "utf8",
      ),
    );

    if (manifest.private !== true) {
      fail(`${manifest.name} must remain internal`);
    }
  }

  pnpm(["run", "build:sdk"]);
  pnpm(["-r", "typecheck"]);
  pnpm(["-r", "test"]);
  pnpm(["--filter", "@tracepack/cli", "build"]);

  for (const folder of packages) {
    pnpm(["--filter", `@tracepack/${folder}`, "pack", "--pack-destination", releaseDir]);
  }

  const archives = readdirSync(releaseDir).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== packages.length) {
    fail(`expected ${packages.length} archives, found ${archives.length}`);
  }

  const requiredArchiveEntries = {
    attestation: [
      "package/package.json",
      "package/LICENSE",
      "package/README.md",
      "package/SPEC.md",
      "package/schema/tracepack-attestation.v1.json",
      "package/dist/index.js",
      "package/dist/index.d.ts",
    ],
    "attestation-sigstore": [
      "package/package.json",
      "package/LICENSE",
      "package/dist/index.js",
      "package/dist/index.d.ts",
    ],
    "pack-attestation": [
      "package/package.json",
      "package/LICENSE",
      "package/dist/index.js",
      "package/dist/index.d.ts",
    ],
  };

  for (const [folder, requiredEntries] of Object.entries(requiredArchiveEntries)) {
    const expectedArchivePrefix =
      folder === "attestation"
        ? "tracepack-attestation-0."
        : `tracepack-${folder}-`;

    const archiveName = archives.find(
      (name) =>
        name.startsWith(
          expectedArchivePrefix,
        ) &&
        name.endsWith(".tgz"),
    );

    if (!archiveName) {
      fail(`missing archive for @tracepack/${folder}`);
    }

    const archivePath = join(
      releaseDir,
      archiveName,
    );

    const contents = execFileSync(
      "tar",
      ["-tzf", archivePath],
      {
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(Boolean);

    const contentSet =
      new Set(contents);

    for (const entry of requiredEntries) {
      if (!contentSet.has(entry)) {
        fail(
          `@tracepack/${folder} archive is missing ${entry}`,
        );
      }
    }

    const forbiddenPrefixes = [
      "package/src/",
      "package/tests/",
      "package/scripts/",
    ];

    for (const entry of contents) {
      if (
        forbiddenPrefixes.some(
          (prefix) =>
            entry.startsWith(prefix),
        )
      ) {
        fail(
          `@tracepack/${folder} archive contains development file ${entry}`,
        );
      }
    }
  }

  run(process.execPath, [join(root, "packages", "cli", "dist", "cli.js"), "--help"]);
  console.log(`Release candidate passed. Reviewed archives were created in ${releaseDir}`);
} catch (error) {
  rmSync(releaseDir, { recursive: true, force: true });
  throw error;
}
