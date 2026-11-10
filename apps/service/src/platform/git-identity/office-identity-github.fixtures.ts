import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitHubUserToken } from "./github-user-token.js";

export const run = promisify(execFile);

export const TOKEN = "ghu_office-test-token-0123456789";

export const COMMIT_AS = ["-c", "user.name=Test", "-c", "user.email=test@example.test"];

/** The github module's access as a test sets it: signed in or not, and what the token read does. */
export class TestUserToken extends GitHubUserToken {
  signedIn = true;
  read: () => Promise<string | undefined> = () => Promise.resolve(TOKEN);
  reads = 0;
  /** Nothing listens on the discard port, so a test that reaches GitHub's list unasked fails. */
  readonly apiUrl = "http://127.0.0.1:9";

  constructor(readonly webUrl: string) {
    super();
  }

  isSignedIn(): Promise<boolean> {
    return Promise.resolve(this.signedIn);
  }

  userToken(): Promise<string | undefined> {
    this.reads += 1;
    return this.read();
  }
}

export async function bareRepositoryWithOneCommit(bare: string, seed: string): Promise<void> {
  await gitCommand(["init", "-q", "--bare", bare], process.env);
  await gitCommand(["init", "-q", seed], process.env);
  await writeFile(join(seed, "README.md"), "seed\n");
  await gitCommand(["-C", seed, "add", "README.md"], process.env);
  await gitCommand(["-C", seed, ...COMMIT_AS, "commit", "-qm", "Seed"], process.env);
  await gitCommand(["-C", seed, "push", "-q", bare, "HEAD:refs/heads/main"], process.env);
  await gitCommand(["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"], process.env);
}

export function basic(token: string): string {
  return `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

export async function gitCommand(
  gitArguments: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ exitCode: number; stderr: string }> {
  return run("git", [...gitArguments], {
    env: environment,
    // Outside any repository: git reads the one it finds in its working directory, and a worktree's
    // .git can point where a run environment doesn't mount.
    cwd: tmpdir(),
    timeout: 30_000,
    windowsHide: true,
  }).then(
    ({ stderr }) => ({ exitCode: 0, stderr }),
    (error: { code?: number; stderr?: string }) => ({
      exitCode: error.code ?? -1,
      stderr: error.stderr ?? "",
    }),
  );
}
