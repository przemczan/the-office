import { copyFile, glob, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolvedInside } from "../../../platform/files/resolved-inside.js";
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
  const matched = new Set<string>();
  for (const pattern of patterns) {
    for await (const match of glob(pattern.trim().replaceAll("\\", "/"), { cwd: checkout })) {
      matched.add(match);
    }
  }
  const sources: { match: string; source: string }[] = [];
  for (const match of [...matched].toSorted()) {
    const resolved = await resolvedInside(checkout, join(checkout, match));
    if (resolved.state === "outside") return { problem: outsideTheCheckout(match) };
    if (resolved.state === "missing") continue;
    if ((await stat(resolved.path)).isFile()) sources.push({ match, source: resolved.path });
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
