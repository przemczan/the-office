import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Name of the session plugin, so every Office skill is listed as `office:<name>` (spec §5.6). */
export const SESSION_PLUGIN_NAME = "office";

export interface SkillFixture {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  /** Supporting files beside `SKILL.md`, by path relative to the skill folder. */
  readonly files?: Readonly<Record<string, string>>;
}

export interface CommandFixture {
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
  private readonly createdRepositories: string[] = [];

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
    this.createdRepositories.push(repository);
    await mkdir(repository);
    await git(repository, "init", "--quiet", "--initial-branch=main");
    await writeFile(join(repository, "README.md"), "# Engine check repository\n");
    await git(repository, "add", "--all");
    await git(repository, "commit", "--quiet", "--message", "Initial commit");
    return repository;
  }

  /** A worktree of `repository` on a new branch, at a stable path under the Office data directory, as the Office makes one per Task (spec §5.5). */
  async addWorktree(repository: string, branch: string): Promise<string> {
    const worktree = join(this.officeData, "worktrees", branch);
    await git(repository, "worktree", "add", "--quiet", "-b", branch, worktree);
    return worktree;
  }

  /** Every repository the check created; the engine keeps a worktree session's memory folder under its repository's name. */
  get repositories(): readonly string[] {
    return this.createdRepositories;
  }

  sessionPluginFolder(sessionId: string): string {
    return join(this.officeData, "sessions", sessionId, "skills");
  }

  /** Rebuilds the folder from scratch, as the Office does on resume, so a dropped skill leaves nothing behind. */
  async writeSessionPlugin(sessionId: string, skills: readonly SkillFixture[]): Promise<string> {
    const folder = this.sessionPluginFolder(sessionId);
    await rm(folder, { recursive: true, force: true });
    await writePlugin(folder, SESSION_PLUGIN_NAME, skills);
    return folder;
  }

  async dispose(): Promise<void> {
    // Retries cover files an ending engine process still holds open on Windows.
    await rm(this.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

/** A plugin folder with `skills/<name>/` for each skill; without a manifest the engine names it after the folder. */
export async function writePlugin(folder: string, manifestName: string | undefined, skills: readonly SkillFixture[]): Promise<void> {
  await mkdir(folder, { recursive: true });
  if (manifestName !== undefined) {
    await writeFileWithFolders(join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name: manifestName }));
  }
  for (const skill of skills) {
    await writeSkill(join(folder, "skills", skill.name), skill);
  }
}

/** A Project skill under `<repository>/<subfolder>/.claude/skills`, the repository root when `subfolder` is omitted. */
export async function writeProjectSkill(repository: string, skill: SkillFixture, subfolder = ""): Promise<void> {
  await writeSkill(join(repository, subfolder, ".claude", "skills", skill.name), skill);
}

/** A Project command, the older single-file form of a skill, under `<repository>/.claude/commands`. */
export async function writeProjectCommand(repository: string, command: CommandFixture): Promise<void> {
  await writeFileWithFolders(
    join(repository, ".claude", "commands", `${command.name}.md`),
    `---\ndescription: ${command.description}\n---\n\n${command.body}\n`,
  );
}

export async function writeSkill(folder: string, skill: SkillFixture): Promise<void> {
  const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n`;
  await writeFileWithFolders(join(folder, "SKILL.md"), `${frontmatter}\n${skill.body}\n`);
  for (const [path, content] of Object.entries(skill.files ?? {})) {
    await writeFileWithFolders(join(folder, path), content);
  }
}

async function writeFileWithFolders(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFileAsync(
    "git",
    ["-c", "user.name=Engine Check", "-c", "user.email=engine-check@localhost", "-c", "commit.gpgsign=false", ...args],
    { cwd: repository },
  );
}
