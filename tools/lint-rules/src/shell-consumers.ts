import path from "node:path";
import { webPlaceOf } from "./web-layers.ts";

/**
 * The shell holds what the shell itself or more than one surface uses; a surface never imports
 * another (web-layers.ts), so the shell is the only place two surfaces share. A shell file only one
 * surface uses, directly or through other shell files, belongs in that surface, beside its consumer.
 *
 * This looks at the whole import graph, which oxlint's rules, one file at a time, can't, so
 * `npm run lint` runs it as a check of its own (shell-consumers-check.ts).
 */

/** A file of apps/web: its path inside apps/web, with forward slashes, and its text. */
export interface WebFile {
  readonly path: string;
  readonly text: string;
}

export interface SingleSurfaceShellFile {
  /** Inside apps/web, e.g. `src/shell/work/use-shaper.ts`. */
  readonly path: string;
  readonly surface: string;
  /** The surface's files that import it, or the shell files that lead there, inside apps/web. */
  readonly importers: readonly string[];
}

// Static and dynamic imports, re-exports, `import type`, side-effect imports and the test runner's
// mocks name their file in a relative specifier; a query such as `?url` is left off.
const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.mock\(\s*|\bimportActual(?:<[^>]*>)?\(\s*)["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;

const TEST_FILE = /(?:\.full)?\.test\.[cm]?[jt]sx?$/;
const SCRIPT_EXTENSION = /\.[cm]?[jt]sx?$/;

/** The files a file imports by a relative specifier, inside apps/web, each once. */
export function relativeImportsOf(file: WebFile): string[] {
  const directory = path.posix.dirname(file.path);
  const imported = [...file.text.matchAll(RELATIVE_SPECIFIER)].map((match) =>
    path.posix.join(directory, match[1]!),
  );
  return [...new Set(imported)];
}

/** Each shell file only one surface uses, and nothing else: no other surface, shell file or the app's composition. */
export function singleSurfaceShellFiles(files: readonly WebFile[]): SingleSurfaceShellFile[] {
  const paths = new Set(files.map((file) => file.path));
  const owners = ownersOf(paths);
  const ownerOf = (filePath: string): string => owners.get(filePath) ?? filePath;

  const importersOf = new Map<string, Set<string>>();
  for (const file of files) {
    const importer = ownerOf(file.path);
    for (const target of relativeImportsOf(file)) {
      const imported = ownerOf(target);
      if (!isShell(imported) || imported === importer) continue;
      const importers = importersOf.get(imported) ?? new Set<string>();
      importers.add(importer);
      importersOf.set(imported, importers);
    }
  }

  // Who reaches each shell file: a surface, or "other" (the composition, the end-to-end tests, the
  // configs), through as many shell files as it takes.
  const reachOf = new Map<string, Set<string>>();
  const shellFiles = [...paths].filter(
    (filePath) => isShell(filePath) && ownerOf(filePath) === filePath,
  );
  for (const shellFile of shellFiles) reachOf.set(shellFile, new Set());
  for (let changed = true; changed;) {
    changed = false;
    for (const shellFile of shellFiles) {
      const reach = reachOf.get(shellFile)!;
      for (const importer of importersOf.get(shellFile) ?? []) {
        for (const consumer of isShell(importer)
          ? reachOf.get(importer)!
          : [consumerOf(importer)]) {
          if (reach.has(consumer)) continue;
          reach.add(consumer);
          changed = true;
        }
      }
    }
  }

  return shellFiles.flatMap((shellFile) => {
    const reach = [...reachOf.get(shellFile)!];
    const surface = reach.length === 1 ? surfaceOf(reach[0]!) : undefined;
    if (surface === undefined) return [];
    const importers = [...(importersOf.get(shellFile) ?? [])].toSorted();
    return [{ path: shellFile, surface, importers }];
  });
}

/** Why the file breaks the rule, for the check to print. */
export function singleSurfaceWords(file: SingleSurfaceShellFile): string {
  return `${file.path} is used by the ${file.surface} surface alone (imported by ${file.importers.join(", ")}): move it into src/surfaces/${file.surface}/, beside what uses it, with its tests. The shell holds only what the shell itself or more than one surface uses (apps/web/src/MAP.md).`;
}

/** A test file belongs to the file it tests, beside it with the same name, and moves with it. */
function ownersOf(paths: ReadonlySet<string>): Map<string, string> {
  const sourcesByStem = new Map<string, string>();
  for (const filePath of paths) {
    if (!TEST_FILE.test(filePath) && SCRIPT_EXTENSION.test(filePath)) {
      sourcesByStem.set(filePath.replace(SCRIPT_EXTENSION, ""), filePath);
    }
  }
  const owners = new Map<string, string>();
  for (const filePath of paths) {
    const tested = TEST_FILE.test(filePath)
      ? sourcesByStem.get(filePath.replace(TEST_FILE, ""))
      : undefined;
    if (tested) owners.set(filePath, tested);
  }
  return owners;
}

function isShell(filePath: string): boolean {
  return webPlaceOf(filePath).kind === "shell";
}

function consumerOf(filePath: string): string {
  const place = webPlaceOf(filePath);
  return place.kind === "surface" ? `surface:${place.surface}` : "other";
}

function surfaceOf(consumer: string): string | undefined {
  return consumer.startsWith("surface:") ? consumer.slice("surface:".length) : undefined;
}
