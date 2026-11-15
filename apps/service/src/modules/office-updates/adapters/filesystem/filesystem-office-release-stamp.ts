import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { OfficeRelease } from "../../domain/office-release.js";
import { OfficeReleaseStamp } from "../../ports/office-release-stamp.js";

/** The stamp's name at the release's root, as `tools/release/src/release-package.ts` writes it. */
const RELEASE_STAMP_FILE = "office-release.json";

const releaseStampSchema = z.object({
  version: z.string().min(1),
  commit: z.string().min(1),
  committedAt: z.iso.datetime({ offset: true }),
  subject: z.string(),
  repository: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .optional(),
});

/** The stamp in the folder The Office runs from; none there in a checkout. */
export class FilesystemOfficeReleaseStamp extends OfficeReleaseStamp {
  constructor(private readonly folder: string) {
    super();
  }

  async read(): Promise<OfficeRelease | undefined> {
    const path = join(this.folder, RELEASE_STAMP_FILE);
    const text = await readIfThere(path);
    if (text === undefined) return undefined;
    const parsed = releaseStampSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new Error(`${path} isn't an Office release's stamp: ${parsed.error}`);
    const { version, commit, committedAt, subject, repository } = parsed.data;
    return {
      version,
      commit: { commit, subject, committedAt: new Date(committedAt) },
      repository,
    };
  }
}

async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
