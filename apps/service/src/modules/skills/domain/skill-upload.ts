import { SKILL_MD, type SkillFile } from "./skill-files.js";
import { nameFromFileName, uploadedDraft, type SkillDraft } from "./skill-draft.js";
import { SkillRefused } from "./skill-refused.js";

/** The most an upload may hold, unpacked: far more than a skill's text needs. */
export const UPLOAD_LIMITS = { bytes: 10 * 1024 * 1024, files: 500 } as const;

export function uploadTooLarge(): string {
  return `An upload may hold at most ${UPLOAD_LIMITS.files} files and ${UPLOAD_LIMITS.bytes / 1024 / 1024} MB.`;
}

/** An entry of a zipped folder or a Source's skill folder, as it names and marks it. */
export type FolderEntry =
  | { readonly kind: "file"; readonly path: string; readonly content: Uint8Array }
  | { readonly kind: "folder" | "link" | "other"; readonly path: string };

/** Files a zip made on macOS carries besides the folder's own. */
const MAC_METADATA = /(?:^|\/)(?:__MACOSX(?:\/|$)|\.DS_Store$)/;

/** Which kind of upload a file name is, or undefined for one the library doesn't take. */
export function uploadKind(fileName: string): "md" | "zip" | undefined {
  if (/\.md$/i.test(fileName)) return "md";
  if (/\.zip$/i.test(fileName)) return "zip";
  return undefined;
}

export function uploadKindProblem(): string {
  return "Upload a single .md file or a zipped folder.";
}

/** A skill from a single uploaded `.md`, which becomes its SKILL.md. */
export function draftFromMd(fileName: string, content: Uint8Array): SkillDraft {
  return uploadedDraft(nameFromFileName(fileName), "uploaded-file", [{ path: SKILL_MD, content }]);
}

/**
 * A skill from an uploaded zip: its folder's regular files, refusing links and anything else
 * that is no file or folder. A zip holding one folder around everything is that folder, which
 * then names the skill when its SKILL.md doesn't.
 */
export function draftFromZip(fileName: string, entries: readonly FolderEntry[]): SkillDraft {
  const kept = entries
    .map((entry) => ({ ...entry, path: entry.path.normalize("NFC").replace(/\/+$/, "") }))
    .filter((entry) => entry.path !== "" && !MAC_METADATA.test(entry.path));
  refuseLinksAndOthers(kept);
  const files: SkillFile[] = kept.flatMap((entry) =>
    entry.kind === "file" ? [{ path: entry.path, content: entry.content }] : [],
  );
  if (files.length === 0) throw new SkillRefused(["The zip holds no files."]);
  const wrapper = wrappingFolder(files);
  if (wrapper === undefined) {
    return uploadedDraft(nameFromFileName(fileName), "uploaded-folder", files);
  }
  const unwrapped = files.map((file) => ({ ...file, path: file.path.slice(wrapper.length + 1) }));
  return uploadedDraft(nameFromFileName(wrapper), "uploaded-folder", unwrapped);
}

/** Refuses links and anything else that is no file or folder, with every reason. */
export function refuseLinksAndOthers(entries: readonly FolderEntry[]): void {
  const refused = entries
    .filter((entry) => entry.kind === "link" || entry.kind === "other")
    .map((entry) =>
      entry.kind === "link"
        ? `"${entry.path}" is a link; a skill holds only its own files.`
        : `"${entry.path}" is not a regular file.`,
    );
  if (refused.length > 0) throw new SkillRefused(refused);
}

/** The one folder every file is in, when the zip has no SKILL.md at its top. */
function wrappingFolder(files: readonly SkillFile[]): string | undefined {
  if (files.some((file) => file.path === SKILL_MD)) return undefined;
  const tops = new Set(files.map((file) => file.path.split("/")[0]));
  const [top] = tops;
  if (tops.size !== 1 || top === undefined) return undefined;
  return files.every((file) => file.path.startsWith(`${top}/`)) ? top : undefined;
}
