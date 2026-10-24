// Build: compile TypeScript to dist/ and copy the static extension files next to it.
import { execFileSync } from "node:child_process";
import { cpSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.json")], { stdio: "inherit" });
for (const file of readdirSync(join(root, "extension"))) cpSync(join(root, "extension", file), join(dist, file), { recursive: true });
console.log("Built extension in dist/ — load it via chrome://extensions → Load unpacked.");
