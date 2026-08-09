import { readFileSync } from "node:fs";
import { checkEvidenceJson, checkManifestDiff, checkTemplateYaml } from "./commands";

const USAGE = `tracepack — validate Tracepack template and evidence files from the command line

Usage:
  tracepack validate-template <file.yaml>          Validate a template.yaml against the real schema
  tracepack validate-evidence <file.json>          Validate a tracepack-evidence v1 payload
  tracepack diff-manifest <before.json> <after.json>
                                                    Diff two exported manifest.json files by
                                                    evidence item id + contentHash

  tracepack --help                                 Show this message
`;

function readFileOrExit(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    console.error(`Could not read "${path}": ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

function run(argv: string[]): number {
  const [command, ...files] = argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  if (command === "validate-template" || command === "validate-evidence") {
    const [file] = files;
    if (!file) {
      console.error(`Missing file argument.\n\n${USAGE}`);
      return 1;
    }
    const text = readFileOrExit(file);
    const result = command === "validate-template" ? checkTemplateYaml(text) : checkEvidenceJson(text);
    console.log(result.message);
    return result.ok ? 0 : 1;
  }

  if (command === "diff-manifest") {
    const [beforeFile, afterFile] = files;
    if (!beforeFile || !afterFile) {
      console.error(`Missing file argument(s). Usage: tracepack diff-manifest <before.json> <after.json>\n\n${USAGE}`);
      return 1;
    }
    const before = readFileOrExit(beforeFile);
    const after = readFileOrExit(afterFile);
    const result = checkManifestDiff(before, after);
    console.log(result.message);
    return result.ok ? 0 : 1;
  }

  console.error(`Unknown command "${command}".\n\n${USAGE}`);
  return 1;
}

process.exit(run(process.argv.slice(2)));
