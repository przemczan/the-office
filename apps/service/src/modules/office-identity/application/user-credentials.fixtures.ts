import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where the user's credentials are, each of which leaves a mark once something uses it. */
export interface UserCredentials {
  /**
   * The user's environment: a home holding `.netrc` (`_netrc` on Windows) and a global git config
   * with a credential helper, one scoped to `scopedTo`, and an ssh command reading their own ssh
   * config, whose proxy command marks the use. The config also includes a file with an `lfs`
   * setting, and the XDG `git/config` and `git/ignore` hold the user's name and an ignored
   * extension.
   */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The Authorization header curl makes from the user's `.netrc`. */
  readonly netrcAuthorization: string;
  /** Which of `credential-helper`, `scoped-credential-helper` and `ssh-config` were used. */
  reached(): Promise<string[]>;
  remove(): Promise<void>;
}

const NETRC_LOGIN = "user-login";
const NETRC_PASSWORD = "user-password";

/** The user's settings, each from a different file of their global config. */
export const USER_NAME = "User From XDG Config";
export const USER_LFS_CONCURRENT_TRANSFERS = 7;
export const USER_IGNORED_EXTENSION = ".ignored-by-user";

/** The user's credentials in a home of their own; `scopedTo` is the URL the scoped helper is for. */
export async function userCredentials(scopedTo: string): Promise<UserCredentials> {
  const home = await mkdtemp(join(tmpdir(), "office-user-home-"));
  const marks = join(home, "reached");
  await mkdir(marks);
  // git runs helpers and ssh commands in sh, which takes Windows paths with forward slashes only.
  const mark = (name: string): string =>
    `echo reached > '${join(marks, name).split("\\").join("/")}'`;
  const sshConfig = join(home, "ssh_config");
  await writeFile(sshConfig, `Host *\n  ProxyCommand ${mark("ssh-config")}\n`);
  const included = join(home, "included.gitconfig");
  await writeFile(included, `[lfs]\n  concurrentTransfers = ${USER_LFS_CONCURRENT_TRANSFERS}\n`);
  await writeFile(
    join(home, ".gitconfig"),
    [
      "[credential]",
      `  helper = ${configValue(`!${mark("credential-helper")}`)}`,
      `[credential ${configValue(scopedTo)}]`,
      `  helper = ${configValue(`!${mark("scoped-credential-helper")}`)}`,
      "[core]",
      `  sshCommand = ${configValue(`ssh -F '${sshConfig.split("\\").join("/")}'`)}`,
      "[include]",
      `  path = ${configValue(included.split("\\").join("/"))}`,
      "",
    ].join("\n"),
  );
  const xdgGit = join(home, ".config", "git");
  await mkdir(xdgGit, { recursive: true });
  await writeFile(join(xdgGit, "config"), `[user]\n  name = ${USER_NAME}\n`);
  await writeFile(join(xdgGit, "ignore"), `*${USER_IGNORED_EXTENSION}\n`);
  const netrc = `machine 127.0.0.1\nlogin ${NETRC_LOGIN}\npassword ${NETRC_PASSWORD}\n`;
  await writeFile(join(home, ".netrc"), netrc);
  await writeFile(join(home, "_netrc"), netrc);
  return {
    environment: {
      ...withoutVariables(process.env, ["HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]),
      // git finds `~/.gitconfig` and `~/.config/git/` from HOME on Windows too.
      HOME: home,
      // The workstation's system helper, Git Credential Manager on Windows, would answer first.
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
    },
    netrcAuthorization: `Basic ${Buffer.from(`${NETRC_LOGIN}:${NETRC_PASSWORD}`).toString("base64")}`,
    reached: async () => (await readdir(marks)).toSorted(),
    remove: () => rm(home, { recursive: true, force: true, maxRetries: 5 }),
  };
}

/**
 * A repository in a folder of its own whose one commit holds an LFS pointer to an object kept at
 * `remote`, its `origin`, so `git lfs fetch origin HEAD` asks `remote`'s LFS API for it.
 */
export async function repositoryWithLfsPointer(remote: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "office-lfs-repository-"));
  const git = (...gitArguments: string[]): Promise<unknown> =>
    run("git", ["-C", folder, ...gitArguments], { windowsHide: true });
  await git("init", "-q");
  await git("remote", "add", "origin", remote);
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 3\n`;
  await writeFile(join(folder, "object.bin"), pointer);
  await git("add", "object.bin");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "LFS");
  return folder;
}

/** Whether git-lfs is installed, which the Linux check's image leaves out. */
export async function isGitLfsInstalled(): Promise<boolean> {
  return run("git", ["lfs", "version"], { windowsHide: true }).then(
    () => true,
    () => false,
  );
}

/** `variables` without `names`, in any case: Windows' names ignore it. */
function withoutVariables(
  variables: NodeJS.ProcessEnv,
  names: readonly string[],
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(variables).filter(([key]) => !names.includes(key.toUpperCase())),
  );
}

/** A git config value in double quotes, which keeps `;` and `#` from starting a comment. */
function configValue(text: string): string {
  return `"${text.replace(/[\\"]/g, "\\$&")}"`;
}

/** An http server that asks every request for a password, as a private repository's host does. */
export interface FakeGitHttpServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** Each request's Authorization header, empty when it sent none. */
  readonly authorizations: readonly string[];
  close(): Promise<void>;
}

/** `offers` are its `WWW-Authenticate` headers; a git-lfs batch request is refused alike. */
export async function startFakeGitHttpServer(
  offers: readonly string[] = ['Basic realm="repository"'],
): Promise<FakeGitHttpServer> {
  const authorizations: string[] = [];
  const server = createServer((request, response) => {
    authorizations.push(request.headers.authorization ?? "");
    request.resume();
    response.writeHead(401, { "WWW-Authenticate": [...offers] }).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    authorizations,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
