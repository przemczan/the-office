import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A git repository in a temp folder, standing for a Task's worktree. */
export interface ProjectCheckout {
  readonly path: string;
  /** Writes a file at a path with `/` between folders, leaving it untracked. */
  write(path: string, text: string): Promise<void>;
  /** Commits every file written so far. */
  commit(): void;
  remove(): Promise<void>;
}

export async function createProjectCheckout(): Promise<ProjectCheckout> {
  const path = await mkdtemp(join(tmpdir(), "office-project-"));
  const git = (...gitArguments: string[]) =>
    execFileSync("git", gitArguments, { cwd: path, stdio: "pipe" });
  git("init", "--quiet", "--initial-branch", "main");
  git("config", "user.name", "The Office");
  git("config", "user.email", "office@localhost");
  return {
    path,
    async write(file, text) {
      const absolute = join(path, ...file.split("/"));
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, text);
    },
    commit() {
      git("add", ".");
      git("commit", "--quiet", "--message", "Skills");
    },
    remove: () => rm(path, { recursive: true, force: true }),
  };
}

/** A SKILL.md of the Project's own. */
export function projectSkillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\nDo it.\n`;
}
