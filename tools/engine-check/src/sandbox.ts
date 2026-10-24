import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Name of the session plugin, so every Office skill is listed as `office:<name>` (spec §5.6). */
export const SESSION_PLUGIN_NAME = "office";

export interface SkillFixture {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

/**
 * A throwaway temp folder for one check: git repositories to run sessions in, and an Office data
 * directory beside them holding each session's plugin folder, outside every repository.
 */
export class Sandbox {
  readonly root: string;
  readonly officeData: string;

  private constructor(root: string) {
    this.root = root;
    this.officeData = join(root, "office-data");
  }

  static async create(): Promise<Sandbox> {
    // realpath resolves Windows short names, so paths match what the engine reports.
    const root = await realpath(await mkdtemp(join(tmpdir(), "office-engine-check-")));
    return new Sandbox(root);
  }

  async createRepository(name = "repository"): Promise<string> {
    const repository = join(this.root, name);
    await mkdir(repository);
    await git(repository, "init", "--quiet", "--initial-branch=main");
    await writeFile(join(repository, "README.md"), "# Engine check repository\n");
    await git(repository, "add", "--all");
    await git(repository, "commit", "--quiet", "--message", "Initial commit");
    return repository;
  }

  sessionPluginFolder(sessionId: string): string {
    return join(this.officeData, "sessions", sessionId, "skills");
  }

  async writeSessionPlugin(sessionId: string, skills: readonly SkillFixture[]): Promise<string> {
    const folder = this.sessionPluginFolder(sessionId);
    await mkdir(join(folder, ".claude-plugin"), { recursive: true });
    await writeFile(join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name: SESSION_PLUGIN_NAME }));
    for (const skill of skills) {
      await writeSkill(join(folder, "skills", skill.name), skill);
    }
    return folder;
  }

  async dispose(): Promise<void> {
    // Retries cover files an ending engine process still holds open on Windows.
    await rm(this.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

export async function writeSkill(folder: string, skill: SkillFixture): Promise<void> {
  await mkdir(folder, { recursive: true });
  const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n`;
  await writeFile(join(folder, "SKILL.md"), `${frontmatter}\n${skill.body}\n`);
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFileAsync(
    "git",
    ["-c", "user.name=Engine Check", "-c", "user.email=engine-check@localhost", "-c", "commit.gpgsign=false", ...args],
    { cwd: repository },
  );
}
