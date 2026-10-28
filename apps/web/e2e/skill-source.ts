import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** A Source of a test's own: a bare repository holding one skill, tagged v1.0.0. */
export interface SkillSource {
  /** The `file://` URL it is installed from: the tests never reach the network. */
  readonly url: string;
  readonly folder: string;
  readonly commit: string;
  readonly tag: string;
  /** The skill's files, path to text. */
  readonly files: Readonly<Record<string, string>>;
  /** As the service hashes a skill's files, so a seeded Proposal matches what is fetched. */
  readonly filesHash: string;
  /** Rewrites the skill's files, commits, tags the commit and pushes both: a newer pinned version. */
  release(tag: string, files: Readonly<Record<string, string>>): Promise<SkillRelease>;
  remove(): Promise<void>;
}

/** A newer version of the Source's skill. */
export interface SkillRelease {
  readonly tag: string;
  readonly commit: string;
  readonly files: Readonly<Record<string, string>>;
  readonly filesHash: string;
}

export async function createSkillSource(name: string, description: string): Promise<SkillSource> {
  const root = await mkdtemp(path.join(tmpdir(), "office-e2e-source-"));
  const checkout = path.join(root, "checkout");
  const folder = `skills/${name}`;
  const files = {
    "SKILL.md": `---\ndescription: ${description}\n---\nGroup them as Added, Changed and Fixed.\n`,
    "template.md": "## Added\n",
  };
  for (const [file, text] of Object.entries(files)) {
    const absolute = path.join(checkout, ...folder.split("/"), file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, text);
  }
  git(checkout, "init", "--quiet", "--initial-branch", "main");
  commit(checkout, "Skills");
  git(checkout, "tag", "v1.0.0");
  const bare = path.join(root, "skills.git");
  git(root, "clone", "--quiet", "--bare", checkout, bare);
  return {
    url: pathToFileURL(bare).href,
    folder,
    commit: git(checkout, "rev-parse", "HEAD"),
    tag: "v1.0.0",
    files,
    filesHash: filesHashOf(files),
    async release(tag, released) {
      for (const [file, text] of Object.entries(released)) {
        await writeFile(path.join(checkout, ...folder.split("/"), file), text);
      }
      commit(checkout, tag);
      git(checkout, "tag", tag);
      git(checkout, "push", "--quiet", bare, "main", `refs/tags/${tag}`);
      const all = { ...files, ...released };
      return {
        tag,
        commit: git(checkout, "rev-parse", "HEAD"),
        files: all,
        filesHash: filesHashOf(all),
      };
    },
    remove: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

/** Commits every change, under an identity of its own: the Linux check's container has none. */
function commit(checkout: string, message: string): void {
  git(checkout, "add", ".");
  git(
    checkout,
    "-c",
    "user.name=The Office",
    "-c",
    "user.email=office@localhost",
    "commit",
    "--quiet",
    "--message",
    message,
  );
}

function git(cwd: string, ...gitArguments: string[]): string {
  return execFileSync("git", gitArguments, { cwd, stdio: "pipe" }).toString("utf8").trim();
}

/**
 * The service's `skillFilesHash`: each path in character order with the SHA-256 of its bytes,
 * hashed together.
 */
function filesHashOf(files: Readonly<Record<string, string>>): string {
  const hash = createHash("sha256");
  for (const file of Object.keys(files).toSorted()) {
    const content = createHash("sha256")
      .update(files[file] ?? "")
      .digest("hex");
    hash.update(`${file}\0${content}\n`);
  }
  return hash.digest("hex");
}
