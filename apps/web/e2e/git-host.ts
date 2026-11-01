import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TemporaryRepository } from "./temporary-repository.ts";

/**
 * A made-up https host whose repositories are bare ones in E2E_GIT_HOST_FOLDER, so a test adds a
 * Project by a Repository URL, which is never a local path. The end-to-end service's git reads it
 * so through `insteadOf`, as a user's global config could, and The Office decides the identity on
 * the URL git really reaches.
 */
export const E2E_GIT_HOST = "https://git.example.test/";

/** Emptied by `serve-office.ts` as the service starts. */
export const E2E_GIT_HOST_FOLDER = path.join(tmpdir(), "office-e2e-git-host");

/** The git config, as environment variables, that serves E2E_GIT_HOST from its folder. */
export function gitHostVariables(): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${E2E_GIT_HOST_FOLDER.replaceAll("\\", "/")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: E2E_GIT_HOST,
  };
}

/** Puts a bare copy of `repository` on the host as `<owner>/<name>` and returns its URL. */
export function serveRepository(
  repository: TemporaryRepository,
  owner: string,
  name: string,
): string {
  const bare = path.join(E2E_GIT_HOST_FOLDER, owner, `${name}.git`);
  execFileSync("git", ["clone", "--quiet", "--bare", repository.path, bare], { stdio: "ignore" });
  return `${E2E_GIT_HOST}${owner}/${name}.git`;
}

/** Makes `branch` at `main` in the served `<owner>/<name>`, as someone pushing to it would. */
export function branchOnHost(owner: string, name: string, branch: string): void {
  const bare = path.join(E2E_GIT_HOST_FOLDER, owner, `${name}.git`);
  execFileSync("git", ["branch", branch, "main"], { cwd: bare, stdio: "ignore" });
}
