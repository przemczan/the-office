import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeIdentity } from "../../../../platform/git-identity/office-identity.js";
import type { PinnedVersion, RemoteRef } from "../../domain/installed-source.js";
import { SKILL_MD } from "../../domain/skill-files.js";
import type { FolderEntry } from "../../domain/skill-upload.js";
import type { SourceFolder } from "../../domain/source-skills.js";
import {
  SourceFetcher,
  SourceNotFetched,
  type SourceDiffRead,
  type SourceRead,
} from "../../ports/source-fetcher.js";

const NETWORK_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

/** An entry of `git ls-tree -r --long`: a blob, a link or a submodule. */
interface TreeEntry {
  readonly mode: string;
  readonly object: string;
  readonly size: number;
  readonly path: string;
}

const LINK_MODE = "120000";
const FILE_MODES = new Set(["100644", "100755"]);

/**
 * Reads Sources with the git on PATH, never through a shell. A pinned version is fetched alone,
 * one commit deep, into a bare repository of its own, and read from git's objects, so no checkout
 * ever writes the Source's files to disk.
 */
@Injectable()
export class GitSourceFetcher extends SourceFetcher {
  private readonly git: SourceGit;

  constructor(identity: OfficeIdentity) {
    super();
    this.git = new SourceGit(identity);
  }

  async refs(url: string): Promise<readonly RemoteRef[]> {
    const output = await this.git.run(tmpdir(), ["ls-remote", "--", url, "HEAD", "refs/tags/*"], {
      remote: await this.git.resolved(url),
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    return output
      .toString("utf8")
      .split("\n")
      .flatMap((line) => {
        const [commit, name] = line.split("\t");
        return commit && name ? [{ name, commit }] : [];
      });
  }

  skillFolders(read: SourceRead): Promise<readonly SourceFolder[]> {
    return inTempRepository(this.git, async (repository) => {
      await fetchPinnedVersion(this.git, repository, read.url, read.pinnedVersion);
      const tree = await treeOf(this.git, repository, read.pinnedVersion.commit);
      const folders = skillFoldersIn(tree).filter(
        (folder) => read.folder === undefined || folder === read.folder,
      );
      return Promise.all(
        folders.map((folder) => readFolder(this.git, repository, folder, tree, read.limits)),
      );
    });
  }

  diff(read: SourceDiffRead): Promise<string> {
    return inTempRepository(this.git, async (repository) => {
      await fetchPinnedVersion(this.git, repository, read.url, read.from);
      await fetchPinnedVersion(this.git, repository, read.url, read.to);
      const inFolder =
        read.folder === "" ? [] : [`--relative=${read.folder}/`, "--", `${read.folder}/`];
      // The user's diff settings never apply: no external diff tool, no text conversion.
      const output = await this.git.run(repository, [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        read.from.commit,
        read.to.commit,
        ...inFolder,
      ]);
      return output.toString("utf8");
    });
  }
}

/** Runs `read` on a bare repository of its own, removed after. */
async function inTempRepository<Result>(
  git: SourceGit,
  read: (repository: string) => Promise<Result>,
): Promise<Result> {
  const repository = await mkdtemp(join(tmpdir(), "office-source-"));
  try {
    await git.run(repository, ["init", "--quiet", "--bare"]);
    return await read(repository);
  } finally {
    // Windows can hold a pack file open for a moment after git exits.
    await rm(repository, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** Fetches the pinned tag, which any server serves, or else the pinned commit by its id. */
async function fetchPinnedVersion(
  git: SourceGit,
  repository: string,
  url: string,
  pinnedVersion: PinnedVersion,
): Promise<void> {
  const wanted =
    pinnedVersion.tag === undefined ? pinnedVersion.commit : `refs/tags/${pinnedVersion.tag}`;
  await git.run(repository, ["fetch", "--quiet", "--depth", "1", "--no-tags", "--", url, wanted], {
    remote: await git.resolved(url),
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  const fetched = (await git.run(repository, ["rev-parse", "FETCH_HEAD^{commit}"]))
    .toString("utf8")
    .trim();
  if (fetched !== pinnedVersion.commit) {
    throw new SourceNotFetched(
      `its tag ${wanted.slice("refs/tags/".length)} points at ${fetched.slice(0, 7)} now, not at the pinned ${pinnedVersion.commit.slice(0, 7)}.`,
    );
  }
}

async function treeOf(git: SourceGit, repository: string, commit: string): Promise<TreeEntry[]> {
  const output = await git.run(repository, ["ls-tree", "-r", "-z", "--long", commit]);
  return output
    .toString("utf8")
    .split("\0")
    .flatMap((line) => {
      // "<mode> <type> <object> <size>\t<path>", the size padded, and "-" for a submodule.
      const match = /^(\d+) \w+ ([0-9a-f]+) +(\d+|-)\t(.+)$/s.exec(line);
      if (!match) return [];
      const [, mode = "", object = "", size = "", path = ""] = match;
      return [{ mode, object, size: size === "-" ? 0 : Number(size), path }];
    });
}

/** Each folder holding a SKILL.md, the top folder as "". */
function skillFoldersIn(tree: readonly TreeEntry[]): string[] {
  return tree.flatMap((entry) => {
    if (entry.path === SKILL_MD) return [""];
    return entry.path.endsWith(`/${SKILL_MD}`) ? [entry.path.slice(0, -SKILL_MD.length - 1)] : [];
  });
}

async function readFolder(
  git: SourceGit,
  repository: string,
  folder: string,
  tree: readonly TreeEntry[],
  limits: SourceRead["limits"],
): Promise<SourceFolder> {
  const prefix = folder === "" ? "" : `${folder}/`;
  const inFolder = tree
    .filter((entry) => entry.path.startsWith(prefix))
    .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) }));
  const files = inFolder.filter((entry) => FILE_MODES.has(entry.mode));
  const bytes = files.reduce((total, file) => total + file.size, 0);
  if (inFolder.length > limits.files || bytes > limits.bytes) return { folder, tooLarge: true };
  const contents = await blobsOf(
    git,
    repository,
    files.map((file) => file.object),
    bytes,
  );
  const entries: FolderEntry[] = inFolder.map((entry) => {
    if (FILE_MODES.has(entry.mode)) {
      return {
        kind: "file",
        path: entry.path,
        content: contents.get(entry.object) ?? new Uint8Array(),
      };
    }
    return { kind: entry.mode === LINK_MODE ? "link" : "other", path: entry.path };
  });
  return { folder, entries };
}

/** Each blob's bytes by its id, read with one `git cat-file --batch`. */
async function blobsOf(
  git: SourceGit,
  repository: string,
  objects: readonly string[],
  bytes: number,
): Promise<Map<string, Uint8Array>> {
  const blobs = new Map<string, Uint8Array>();
  if (objects.length === 0) return blobs;
  const unique = [...new Set(objects)];
  const output = await git.run(repository, ["cat-file", "--batch"], {
    input: `${unique.join("\n")}\n`,
    // Each blob comes with a header line of its id, type and size.
    outputLimit: bytes + unique.length * 128,
  });
  let offset = 0;
  while (offset < output.length) {
    const headerEnd = output.indexOf(0x0a, offset);
    const [object = "", , size = "0"] = output
      .subarray(offset, headerEnd)
      .toString("utf8")
      .split(" ");
    const start = headerEnd + 1;
    const end = start + Number(size);
    blobs.set(object, new Uint8Array(output.subarray(start, end)));
    offset = end + 1;
  }
  return blobs;
}

interface GitOptions {
  /** The URL or path the command reaches, as git resolves it; none for a local command. */
  readonly remote?: string;
  readonly timeoutMs?: number;
  readonly input?: string;
  readonly outputLimit?: number;
}

/** The git on PATH, never through a shell, each command on the Office identity. */
class SourceGit {
  constructor(private readonly identity: OfficeIdentity) {}

  /** Where git reaches for `url`: the user's `insteadOf` rewrites apply, which may change its transport. */
  async resolved(url: string): Promise<string> {
    return (await this.run(tmpdir(), ["ls-remote", "--get-url", "--", url]))
      .toString("utf8")
      .trim();
  }

  async run(
    folder: string,
    gitArguments: readonly string[],
    {
      remote,
      timeoutMs = LOCAL_TIMEOUT_MS,
      input,
      outputLimit = OUTPUT_LIMIT_BYTES,
    }: GitOptions = {},
  ): Promise<Buffer> {
    const identity = await this.identity.forGitCommand(remote, { ...process.env, LC_ALL: "C" });
    return new Promise<Buffer>((resolve, reject) => {
      const child = execFile(
        "git",
        [...identity.configArguments, "-C", folder, ...gitArguments],
        {
          encoding: "buffer",
          env: identity.variables,
          timeout: timeoutMs,
          maxBuffer: outputLimit,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout);
          const detail = error.killed
            ? `git ${gitArguments[0] ?? ""} took longer than ${timeoutMs / 1000} s.`
            : causeOf(stderr.toString("utf8")) || error.message;
          reject(new SourceNotFetched(detail));
        },
      );
      child.stdin?.end(input);
    }).finally(() => identity.release());
  }
}

/** git's fatal line names the cause; the lines around it are hints. */
function causeOf(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("hint:"));
  return (
    lines.find((line) => line.startsWith("fatal:"))?.replace(/^fatal: /, "") ?? lines.at(-1) ?? ""
  );
}
