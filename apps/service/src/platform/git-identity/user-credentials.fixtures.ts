import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where the user's credentials are, each of which leaves a mark once something uses it. */
export interface UserCredentials {
  /**
   * The user's environment: a home holding `.netrc` (`_netrc` on Windows) and a global git config
   * with a credential helper, one scoped to `scopedTo`, and an ssh command reading their own ssh
   * config, whose proxy command marks the use.
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
  const gitConfig = join(home, ".gitconfig");
  await writeFile(
    gitConfig,
    [
      "[credential]",
      `  helper = ${configValue(`!${mark("credential-helper")}`)}`,
      `[credential ${configValue(scopedTo)}]`,
      `  helper = ${configValue(`!${mark("scoped-credential-helper")}`)}`,
      "[core]",
      `  sshCommand = ${configValue(`ssh -F '${sshConfig.split("\\").join("/")}'`)}`,
      "",
    ].join("\n"),
  );
  const netrc = `machine 127.0.0.1\nlogin ${NETRC_LOGIN}\npassword ${NETRC_PASSWORD}\n`;
  await writeFile(join(home, ".netrc"), netrc);
  await writeFile(join(home, "_netrc"), netrc);
  return {
    environment: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_GLOBAL: gitConfig,
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

export async function startFakeGitHttpServer(): Promise<FakeGitHttpServer> {
  const authorizations: string[] = [];
  const server = createServer((request, response) => {
    authorizations.push(request.headers.authorization ?? "");
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="repository"' }).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    authorizations,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
