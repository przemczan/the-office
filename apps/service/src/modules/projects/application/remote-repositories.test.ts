import { execFileSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ProjectRemotes } from "./project-remotes.js";
import { RemoteRepositories } from "./remote-repositories.js";
import { MANIFEST_CHARACTERS } from "./repository-folder.js";

const HOST = "https://git.example.test/acme/";
const ORIGIN_URL = `${HOST}origin.git`;

let repository: TemporaryRepository;
let madeUpHost: Record<string, string>;
let remoteRepositories: RemoteRepositories;
let tipCommit: string;

/** Git config, as the user's could hold it, that reads the made-up host as the temp folder. */
function madeUpHostConfig(folder: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${folder.replaceAll("\\", "/")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: HOST,
  };
}

/** Adds an entry of the given mode to the index without a file behind it, as a link or submodule is. */
function addToIndex(path: string, mode: string, object: string): void {
  gitIn(repository.path, "update-index", "--add", "--cacheinfo", `${mode},${object},${path}`);
}

beforeAll(async () => {
  repository = await createTemporaryRepository();
  const { path } = repository;
  await writeFile(join(path, "package.json"), '{ "name": "shop" }\n');
  await writeFile(join(path, "README.md"), "x".repeat(MANIFEST_CHARACTERS + 10));
  await mkdir(join(path, "apps", "server"), { recursive: true });
  await writeFile(join(path, "apps", "server", "package.json"), '{ "name": "server" }\n');
  gitIn(path, "add", ".");
  const linkTarget = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: path,
    input: "elsewhere",
    encoding: "utf8",
  }).trim();
  addToIndex("out", "120000", linkTarget);
  addToIndex("vendor/lib", "160000", gitIn(path, "rev-parse", "HEAD"));
  gitIn(path, "commit", "--quiet", "--message", "The shop");
  gitIn(path, "branch", "develop");
  gitIn(path, "push", "--quiet", "origin", "main", "develop");
  tipCommit = gitIn(path, "rev-parse", "HEAD");
  gitIn(repository.folder, "init", "--quiet", "--bare", "empty.git");

  madeUpHost = madeUpHostConfig(repository.folder);
  Object.assign(process.env, madeUpHost);
  const identity = officeIdentityForTests(join(repository.folder, "office-data"));
  const git = new CommandLineGit(new RepositoryLocks(), identity);
  remoteRepositories = new RemoteRepositories(git, new ProjectRemotes(git, identity));
}, REAL_GIT_TEST.timeout);

afterAll(async () => {
  for (const name of Object.keys(madeUpHost)) delete process.env[name];
  await repository.remove();
});

async function refusalOf(url: string, folder?: string): Promise<string> {
  return remoteRepositories.read(url, folder).then(
    () => "read",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

/** The temp folders reads fetch into. */
async function fetchFolders(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith("office-repository-"));
}

describe("RemoteRepositories", REAL_GIT_TEST, () => {
  it("reads the default branch's top level, with the remote's branches", async () => {
    const read = await remoteRepositories.read(` ${ORIGIN_URL} `);

    expect(read).toMatchObject({
      url: ORIGIN_URL,
      defaultBranch: "main",
      commit: tipCommit,
      folder: "",
      entries: [
        { name: "apps", kind: "folder" },
        { name: "out", kind: "file" },
        { name: "package.json", kind: "file" },
        { name: "README.md", kind: "file" },
        { name: "src", kind: "folder" },
        { name: "vendor", kind: "folder" },
      ],
    });
    expect(read.branches.toSorted()).toEqual(["develop", "main"]);
    expect(read.manifests.map(({ name, cut }) => ({ name, cut }))).toEqual([
      { name: "package.json", cut: false },
      { name: "README.md", cut: true },
    ]);
    expect(read.manifests[1]?.text).toHaveLength(MANIFEST_CHARACTERS);
  });

  it("reads a folder inside the repository as it reads the top level", async () => {
    const read = await remoteRepositories.read(ORIGIN_URL, "apps/./server/");

    expect(read.folder).toBe("apps/server");
    expect(read.entries).toEqual([{ name: "package.json", kind: "file" }]);
    expect(read.manifests).toEqual([
      { name: "package.json", text: '{ "name": "server" }\n', cut: false },
    ]);
  });

  it("keeps nothing it fetched", async () => {
    const before = await fetchFolders();

    await remoteRepositories.read(ORIGIN_URL);

    expect(await fetchFolders()).toEqual(before);
  });

  it("refuses a folder that isn't one inside the repository, never following a link", async () => {
    expect(await refusalOf(ORIGIN_URL, "missing")).toBe("The repository has no folder missing.");
    expect(await refusalOf(ORIGIN_URL, "package.json")).toBe(
      "package.json is a file, not a folder.",
    );
    expect(await refusalOf(ORIGIN_URL, "out")).toBe("out is a file, not a folder.");
    expect(await refusalOf(ORIGIN_URL, "out/inside")).toBe(
      "The repository has no folder out/inside.",
    );
    expect(await refusalOf(ORIGIN_URL, "vendor/lib")).toBe(
      "vendor/lib is a submodule, another repository: read it by its own URL.",
    );
    expect(await refusalOf(ORIGIN_URL, "apps/../..")).toBe(
      "apps/../.. is not a folder inside the repository.",
    );
    expect(await refusalOf(ORIGIN_URL, "/apps")).toBe(
      "Give the folder relative to the repository's top level, not as a full path: /apps.",
    );
  });

  it("refuses what isn't a Repository URL, as adding a Project by URL does", async () => {
    expect(await refusalOf(repository.originPath)).toMatch(
      /A folder on this computer is added by its path\.$/,
    );
    expect(await refusalOf("ftp://git.example.test/acme/origin")).toBe(
      "The Office clones over https and ssh only, not ftp.",
    );
  });

  it("refuses an empty repository, and one git can't reach, in git's words", async () => {
    expect(await refusalOf(`${HOST}empty.git`)).toBe(
      "The repository has no commits yet, so nothing to read.",
    );
    expect(await refusalOf(`${HOST}absent.git`)).toMatch(/^git couldn't read the repository: .+/);
  });

  it("refuses an ssh host whose key isn't trusted yet, before running git", async () => {
    expect(await refusalOf("git@git.example.test:acme/origin.git")).toContain(
      "The Office doesn't trust git.example.test's host key yet",
    );
  });
});
