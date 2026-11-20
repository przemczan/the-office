/** What a folder over the service's limit left out, or nothing when every entry is listed. */
export function leftOutWords(folder: {
  readonly entries: readonly unknown[];
  readonly total: number;
}): string | null {
  const leftOut = folder.total - folder.entries.length;
  if (leftOut <= 0) return null;
  return `Showing the first ${folder.entries.length.toLocaleString("en")} of ${folder.total.toLocaleString("en")} entries: ${leftOut.toLocaleString("en")} left out.`;
}

export function emptyFolderWords(extensions: readonly string[]): string {
  if (extensions.length === 0) return "No files in this folder";
  const named = extensions.map((extension) => `.${extension.replace(/^\./, "")}`);
  const words = new Intl.ListFormat("en", { type: "disjunction" }).format(named);
  return `No ${words} files in this folder`;
}

const KB = 1024;
const MB = 1024 * KB;

/** "1.9 MB", "340 KB", "512 bytes". */
export function fileSizeWords(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
}

/** A path's entry within its folder, joined as the repository names it: "" is the top level. */
export function pathIn(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/** The folder holding a path, "" for one at the top level. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Every folder above a path, the top level's children first: "a/b/c" gives "a" and "a/b". */
export function foldersAbove(path: string): string[] {
  const names = path.split("/").slice(0, -1);
  return names.map((_, index) => names.slice(0, index + 1).join("/"));
}

/** Markdown is told by the file's name, as the service tells only text from binary. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
