import { access } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

/** Path equality as the platform compares paths, case-insensitive on Windows. */
export function samePath(a: string, b: string): boolean {
  return relative(a, b) === "";
}

/** Whether `path` is `folder` itself or anywhere below it. */
export function isWithin(path: string, folder: string): boolean {
  const fromFolder = relative(folder, path);
  return fromFolder === "" || (!fromFolder.startsWith("..") && !isAbsolute(fromFolder));
}

/** Permission rules write an absolute path `//`-rooted in POSIX form, a Windows drive as `/c`. */
export function rulePath(path: string): string {
  return `/${path.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)}`;
}

export async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
