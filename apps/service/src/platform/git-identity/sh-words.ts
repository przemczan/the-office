import { sep } from "node:path";

/** One word for sh, which git runs its ssh command and `!` credential helpers in. */
export function shellQuoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** A path as sh takes it: Windows paths with forward slashes only. */
export function forSh(path: string): string {
  return path.split(sep).join("/");
}
