import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Injectable } from "@nestjs/common";
import { OfficeIdentity } from "../../../../platform/git-identity/office-identity.js";
import type { ProjectSkillFile } from "../../domain/session-skills.js";
import { ProjectSkillFiles } from "../../ports/project-skill-files.js";

const run = promisify(execFile);
const TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

/** The files git tracks, or would, so the repository's ignored folders are never walked. */
const PATHSPECS = [":(glob)**/.claude/skills/*/SKILL.md", ":(glob)**/.claude/commands/**/*.md"];

/**
 * Asks the git on PATH, never through a shell, which files of the checkout are skills; on the
 * Office identity, as every Office git command is, though this one reaches no remote.
 */
@Injectable()
export class GitProjectSkillFiles extends ProjectSkillFiles {
  constructor(private readonly identity: OfficeIdentity) {
    super();
  }

  async files(folder: string): Promise<readonly ProjectSkillFile[]> {
    const { configArguments, variables, release } = await this.identity.forGitCommand(
      undefined,
      process.env,
    );
    const { stdout } = await run(
      "git",
      [
        ...configArguments,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ...PATHSPECS,
      ],
      {
        cwd: folder,
        env: variables,
        timeout: TIMEOUT_MS,
        maxBuffer: OUTPUT_LIMIT_BYTES,
        windowsHide: true,
      },
    ).finally(release);
    const paths = [...new Set(stdout.split("\0").filter((path) => path !== ""))];
    const files = await Promise.all(
      paths.map(async (path) => {
        // A file git lists may be gone from the checkout, deleted but not yet staged.
        const text = await readFile(join(folder, ...path.split("/")), "utf8").catch(
          () => undefined,
        );
        return text === undefined ? [] : [{ path, text }];
      }),
    );
    return files.flat();
  }
}
