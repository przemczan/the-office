import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** A bare git repository in a temp folder standing for a Source, with a checkout that pushes to it. */
export interface SourceRepository {
  /** The `file://` URL the Source is fetched from: tests never reach the network. */
  readonly url: string;
  /** Writes a file at a path with `/` between folders. */
  write(path: string, content: string | Uint8Array): Promise<void>;
  /** Stages a link at `path` to `target`, on every system. */
  link(path: string, target: string): void;
  /** Commits every file written so far, pushes it and returns the commit's id. */
  commit(): string;
  /** Tags the newest commit and pushes the tag; an annotated tag is an object of its own. */
  tag(name: string, kind?: "lightweight" | "annotated"): void;
  remove(): Promise<void>;
}

function git(cwd: string, ...gitArguments: string[]): string {
  return execFileSync("git", gitArguments, { cwd, stdio: "pipe" }).toString("utf8").trim();
}

export async function createSourceRepository(): Promise<SourceRepository> {
  const root = await mkdtemp(join(tmpdir(), "office-source-fixture-"));
  const bare = join(root, "source.git");
  const checkout = join(root, "checkout");
  await mkdir(bare);
  await mkdir(checkout);
  git(bare, "init", "--quiet", "--bare", "--initial-branch", "main");
  git(checkout, "init", "--quiet", "--initial-branch", "main");
  git(checkout, "config", "user.name", "The Office");
  git(checkout, "config", "user.email", "office@localhost");
  git(checkout, "remote", "add", "origin", bare);
  return {
    url: pathToFileURL(bare).href,
    async write(path, content) {
      const absolute = join(checkout, ...path.split("/"));
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content);
    },
    link(path, target) {
      const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
        cwd: checkout,
        input: target,
      })
        .toString("utf8")
        .trim();
      git(checkout, "update-index", "--add", "--cacheinfo", `120000,${blob},${path}`);
    },
    commit() {
      // A staged link is no file in the checkout, so it must not be staged as removed.
      git(checkout, "add", "--ignore-removal", ".");
      git(checkout, "commit", "--quiet", "--message", "Skills");
      git(checkout, "push", "--quiet", "origin", "main");
      return git(checkout, "rev-parse", "HEAD");
    },
    tag(name, kind = "lightweight") {
      if (kind === "annotated") git(checkout, "tag", "--annotate", "--message", name, name);
      else git(checkout, "tag", name);
      git(checkout, "push", "--quiet", "origin", `refs/tags/${name}`);
    },
    remove: () => rm(root, { recursive: true, force: true, maxRetries: 5 }),
  };
}

/** A source's SKILL.md. */
export function sourceSkillMd(description: string, name?: string): string {
  return `---\n${name === undefined ? "" : `name: ${name}\n`}description: ${description}\n---\nDo it.\n`;
}
