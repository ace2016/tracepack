import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(import.meta.dirname, "../../workspace/dist");
const target = resolve(import.meta.dirname, "../dist/workspace");
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
