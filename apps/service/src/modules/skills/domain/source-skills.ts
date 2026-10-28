import { fallbackNameOf, type InstalledSource } from "./installed-source.js";
import type { SkillFile } from "./skill-files.js";
import { uploadedDraft, type SkillDraft } from "./skill-draft.js";
import { SkillRefused } from "./skill-refused.js";
import { refuseLinksAndOthers, UPLOAD_LIMITS, type FolderEntry } from "./skill-upload.js";

/**
 * A folder holding a SKILL.md in a Source at a pinned version, with what is in it. One over the
 * limits a skill's files keep to is only marked, so its files are never read.
 */
export type SourceFolder =
  | { readonly folder: string; readonly entries: readonly FolderEntry[] }
  | { readonly folder: string; readonly tooLarge: true };

/** A skill's files keep to the upload limits however they arrive. */
export const SOURCE_FOLDER_LIMITS = UPLOAD_LIMITS;

export function sourceFolderTooLarge(folder: string): string {
  const where = folder === "" ? "The source's top folder" : `"${folder}"`;
  return `${where} holds more than a skill may: at most ${SOURCE_FOLDER_LIMITS.files} files and ${SOURCE_FOLDER_LIMITS.bytes / 1024 / 1024} MB.`;
}

/** The skill a Source's folder holds, as installing it adds it. Refuses with every reason. */
export function installedDraft(source: InstalledSource, fetched: SourceFolder): SkillDraft {
  if ("tooLarge" in fetched) throw new SkillRefused([sourceFolderTooLarge(fetched.folder)]);
  refuseLinksAndOthers(fetched.entries);
  const files: SkillFile[] = fetched.entries.flatMap((entry) =>
    entry.kind === "file" ? [{ path: entry.path, content: entry.content }] : [],
  );
  const draft = uploadedDraft(fallbackNameOf(source), "installed", files);
  return { skill: { ...draft.skill, installedFrom: source }, files: draft.files };
}
