// `npm run maps` writes each mapped folder's MAP.md; `npm run maps:check` (in `verify`) fails when one is out of date
// or its handwritten part is over its caps.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mappedFolders, type MappedFolder } from "./mapped-folders.ts";
import { handwrittenProblems, mapText, type SourceFile } from "./module-map.ts";

const MAP_FILE = "MAP.md";
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const checkOnly = process.argv.includes("--check");

const oversized: string[] = [];
const stale = mappedFolders(repositoryRoot).filter((mapped) => {
  const mapPath = join(repositoryRoot, mapped.folder, MAP_FILE);
  const existing = existsSync(mapPath)
    ? readFileSync(mapPath, "utf8").replaceAll("\r\n", "\n")
    : undefined;
  const expected = mapText(mapped.title, existing, sourceFiles(mapped));
  oversized.push(
    ...handwrittenProblems(expected).map((problem) => `${mapped.folder}/${MAP_FILE}: ${problem}`),
  );
  if (expected === existing) return false;
  if (!checkOnly) writeFileSync(mapPath, expected);
  return true;
});

if (oversized.length > 0) {
  console.error(
    `Over the handwritten part's caps (Owns, Talks to, Traps and Spec links; behaviour belongs in the spec):\n${oversized.join("\n")}`,
  );
  process.exitCode = 1;
}

if (checkOnly && stale.length > 0) {
  console.error(
    `Out of date: ${stale.map((mapped) => `${mapped.folder}/${MAP_FILE}`).join(", ")}. Run npm run maps and commit the maps.`,
  );
  process.exitCode = 1;
} else if (!checkOnly) {
  console.log(stale.length > 0 ? `Wrote ${stale.length} map(s).` : "Every map is up to date.");
}

function sourceFiles(mapped: MappedFolder): SourceFile[] {
  const folder = join(repositoryRoot, mapped.folder);
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /\.tsx?$/.test(path) && !path.split("/").includes("node_modules"))
    .filter((path) => !mapped.excluded.some((excluded) => path.startsWith(`${excluded}/`)))
    .map((path) => ({ path, text: readFileSync(join(folder, path), "utf8") }));
}
