import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import {
  userCredentials,
  type UserCredentials,
} from "../../../../platform/git-identity/user-credentials.fixtures.js";
import { GitCommandFailed, type GitVariables } from "../../ports/git.js";
import { CommandLineGit } from "./command-line-git.js";
import { exists, serviceVariables, WorktreeMaker } from "./command-line-git.fixtures.js";
import { RepositoryLocks } from "./repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
  REAL_GIT_TEST,
} from "./temporary-repository.fixtures.js";

const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
let repository: TemporaryRepository;
let worktrees: WorktreeMaker;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  worktrees = new WorktreeMaker(git, repository);
});

afterAll(async () => {
  await repository.remove();
});

describe("CommandLineGit on the Office identity", REAL_GIT_TEST, () => {
  /** Nothing listens on port 1, so ssh fails once it has picked its key and config. */
  const SSH_REMOTE = "ssh://git@127.0.0.1:1/";
  let officeData: string;
  let identifiedGit: CommandLineGit;
  let user: UserCredentials;
  let userVariables: GitVariables;

  beforeEach(async () => {
    officeData = join(repository.folder, `office-data-${randomUUID()}`);
    identifiedGit = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests(officeData));
    user = await userCredentials("https://127.0.0.1");
    userVariables = Object.fromEntries(
      Object.entries(user.environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    // A remote named by an https URL the repository rewrites to ssh, as many users' config does.
    gitIn(repository.path, "remote", "add", "rewritten", "https://rewritten.example/repo.git");
    gitIn(repository.path, "config", `url.${SSH_REMOTE}.insteadOf`, "https://rewritten.example/");
  });

  afterEach(async () => {
    gitIn(repository.path, "remote", "remove", "rewritten");
    gitIn(repository.path, "config", "--remove-section", `url.${SSH_REMOTE}`);
    await user.remove();
  });

  const officeSshKey = (): string => join(officeData, "identity", "office_ssh_key");

  it("fetches from the URL git resolves for the remote, with the Office ssh key alone", async () => {
    const fetching = identifiedGit.fetch(
      repository.path,
      { remote: "rewritten", branch: "main" },
      userVariables,
    );

    await expect(fetching).rejects.toBeInstanceOf(GitCommandFailed);
    expect(await exists(officeSshKey())).toBe(true);
    expect(await user.reached()).toEqual([]);
    // The control: the same fetch without the identity takes the user's ssh config.
    expect(() =>
      execFileSync("git", ["-C", repository.path, "fetch", "rewritten"], {
        env: user.environment,
        stdio: "pipe",
      }),
    ).toThrow(/Command failed/);
    expect(await user.reached()).toEqual(["ssh-config"]);
  });

  it("pushes to the remote's push URL with the Office ssh key alone", async () => {
    gitIn(repository.path, "remote", "set-url", "rewritten", "https://unused.example/repo.git");
    gitIn(repository.path, "remote", "set-url", "--push", "rewritten", `${SSH_REMOTE}repo.git`);

    const pushing = identifiedGit.push(
      repository.path,
      "main",
      { remote: "rewritten", branch: "main" },
      userVariables,
    );

    await expect(pushing).rejects.toBeInstanceOf(GitCommandFailed);
    expect(await exists(officeSshKey())).toBe(true);
    expect(await user.reached()).toEqual([]);
  });

  it("reads a remote's URL as git resolves it", async () => {
    await expect(identifiedGit.fetchUrlOf(repository.path, "rewritten")).resolves.toBe(
      `${SSH_REMOTE}repo.git`,
    );
    await expect(identifiedGit.fetchUrlOf(repository.path, "../elsewhere.git")).resolves.toBe(
      "../elsewhere.git",
    );
  });
});

describe("CommandLineGit with a Project's serviceVariables", REAL_GIT_TEST, () => {
  it("runs the repository's hooks with them", async () => {
    const hook = join(repository.path, ".git", "hooks", "post-checkout");
    const written = join(repository.folder, "post-checkout.txt");
    await writeFile(hook, `#!/bin/sh\necho "$GREETING" > "${written.replaceAll("\\", "/")}"\n`, {
      mode: 0o755,
    });

    try {
      await git.addWorktree(repository.path, worktrees.detachedAtMain(), {
        ...serviceVariables,
        GREETING: "hello",
      });
    } finally {
      await rm(hook);
    }

    await expect(readFile(written, "utf8")).resolves.toBe("hello\n");
  });
});
