// A git repository for the release tests, with main's history as it stands before the first
// release: old Conventional Commits and Stage commits, then the commit that adds the release config.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASE_CONFIG } from "./release-commits.ts";

export interface ThrowawayRepository {
  readonly path: string;
  git(...args: string[]): string;
  /** An empty commit with `message`; its hash. */
  commit(message: string): string;
  /** The commit that adds RELEASE_CONFIG, which starts the release history; its hash. */
  addReleaseConfig(): string;
  remove(): void;
}

/** The commits main holds from before releases: they must never be released. */
export const OLD_HISTORY = [
  "feat: task 12 step 3 adds the Work board",
  "Implement: Archive a finished Task",
  "fix: the queue starts the next Task",
] as const;

export function throwawayRepository(): ThrowawayRepository {
  const path = mkdtempSync(join(tmpdir(), "office-release-"));
  const repository: ThrowawayRepository = {
    path,
    git(...args) {
      const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];
      const unsigned = ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"];
      return execFileSync("git", [...identity, ...unsigned, ...args], {
        cwd: path,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      }).trim();
    },
    commit(message) {
      repository.git("commit", "--quiet", "--allow-empty", "-m", message);
      return repository.git("rev-parse", "HEAD");
    },
    addReleaseConfig() {
      writeFileSync(join(path, RELEASE_CONFIG), "{}\n");
      repository.git("add", RELEASE_CONFIG);
      return repository.commit("Implement: Versioned releases");
    },
    remove() {
      rmSync(path, { recursive: true, force: true });
    },
  };
  repository.git("init", "--quiet", "--initial-branch=main");
  for (const message of OLD_HISTORY) repository.commit(message);
  return repository;
}
