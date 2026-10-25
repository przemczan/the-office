import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Injectable } from "@nestjs/common";
import { ProjectSkillFiles } from "../../ports/project-skill-files.js";

const run = promisify(execFile);
const TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

/** The files git tracks, or would, so the repository's ignored folders are never walked. */
const PATHSPECS = [":(glob)**/.claude/skills/*/SKILL.md", ":(glob)**/.claude/commands/**/*.md"];

/** Asks the git on PATH, never through a shell, which files of the checkout are skills. */
@Injectable()
export class GitProjectSkillFiles extends ProjectSkillFiles {
  async paths(folder: string): Promise<readonly string[]> {
    const { stdout } = await run(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...PATHSPECS],
      { cwd: folder, timeout: TIMEOUT_MS, maxBuffer: OUTPUT_LIMIT_BYTES, windowsHide: true },
    );
    return [...new Set(stdout.split("\0").filter((path) => path !== ""))];
  }
}
