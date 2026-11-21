import { copyFile, glob, lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  keptNamesOf,
  noMatch,
  outputPatternProblem,
  outsideTheCheckout,
} from "../domain/test-build.js";

/** One kept file: its name in `test-builds/<id>/` and its size in bytes. */
export type KeptFile = { readonly name: string; readonly size: number };

/** What keeping a build's outputs came to: the names kept, or why none was. */
export type KeptOutputs = { readonly files: readonly KeptFile[] } | { readonly problem: string };

/**
 * Copies the files matching the output patterns in the checkout into `destination` (spec §2.12,
 * "Build to install"): a pattern leading out of the checkout, or a match resolving outside it (a
 * link, a `..`), is refused, naming it, and nothing is copied; no match at all is refused, naming
 * the patterns. Only regular files are kept, each under its base name made unique.
 */
export async function keepOutputs(
  checkout: string,
  patterns: readonly string[],
  destination: string,
): Promise<KeptOutputs> {
  for (const pattern of patterns) {
    const problem = outputPatternProblem(pattern);
    if (problem !== undefined) return { problem };
  }
  const root = await realpath(checkout);
  const matched = new Set<string>();
  for (const pattern of patterns) {
    for await (const match of glob(pattern.trim().replaceAll("\\", "/"), { cwd: checkout })) {
      matched.add(match);
    }
  }
  const sources: { match: string; source: string }[] = [];
  for (const match of [...matched].toSorted()) {
    const source = await realpath(join(checkout, match)).catch(() => undefined);
    if (source === undefined) {
      // A link to nothing: it can't be inside the checkout either.
      if ((await lstat(join(checkout, match))).isSymbolicLink()) {
        return { problem: outsideTheCheckout(match) };
      }
      continue;
    }
    if (!inside(root, source)) return { problem: outsideTheCheckout(match) };
    if ((await stat(source)).isFile()) sources.push({ match, source });
  }
  if (sources.length === 0) return { problem: noMatch(patterns) };

  const names = keptNamesOf(sources.map(({ match }) => match));
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const files: KeptFile[] = [];
  try {
    for (const [index, { source }] of sources.entries()) {
      const name = names[index] ?? "";
      await copyFile(source, join(destination, name));
      files.push({ name, size: (await stat(join(destination, name))).size });
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return { files };
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot !== "" &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}
