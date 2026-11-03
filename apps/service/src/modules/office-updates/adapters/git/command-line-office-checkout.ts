import { execFile } from "node:child_process";
import type { OfficeCommit } from "../../domain/office-commit.js";
import { OfficeCheckout, type UpstreamRead } from "../../ports/office-checkout.js";

const FETCH_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const FIELD = "\x1f";
const COMMIT_FORMAT = `--format=%H${FIELD}%cI${FIELD}%s`;
const UPSTREAM = "@{upstream}";

/**
 * The checkout at `directory`, read with the git on PATH as the service's own user, with its own
 * config: this is no Project, so the Office identity has no part in it.
 */
export class CommandLineOfficeCheckout extends OfficeCheckout {
  constructor(private readonly directory: string) {
    super();
  }

  async current(): Promise<OfficeCommit> {
    const [commit] = commitsFrom(await this.git(["log", "-1", COMMIT_FORMAT, "HEAD"]));
    if (!commit) throw new Error(`${this.directory} has no commit checked out.`);
    return commit;
  }

  async readUpstream(): Promise<UpstreamRead> {
    const current = await this.current();
    const localChanges = (await this.git(["status", "--porcelain", "--untracked-files=no"])) !== "";
    const upstream = await this.upstream();
    if (!upstream) {
      return {
        current,
        localChanges,
        upstream,
        ahead: 0,
        newest: undefined,
        behind: [],
        fetchProblem: undefined,
      };
    }
    const fetchProblem = await this.git(["fetch", "--quiet", "--no-tags"], FETCH_TIMEOUT_MS).then(
      () => undefined,
      (error: unknown) => `The upstream couldn't be fetched: ${messageOf(error)}`,
    );
    const ahead = Number(await this.git(["rev-list", "--count", `${UPSTREAM}..HEAD`]));
    const behind = commitsFrom(await this.git(["log", COMMIT_FORMAT, `HEAD..${UPSTREAM}`]));
    const [newest] = commitsFrom(await this.git(["log", "-1", COMMIT_FORMAT, UPSTREAM]));
    return { current, localChanges, upstream, ahead, newest, behind, fetchProblem };
  }

  /** The upstream branch's name, as `origin/main`; undefined when the branch has none. */
  private upstream(): Promise<string | undefined> {
    return this.git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", UPSTREAM]).then(
      (name) => name || undefined,
      () => undefined,
    );
  }

  private git(args: readonly string[], timeout = LOCAL_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        { cwd: this.directory, timeout, maxBuffer: OUTPUT_LIMIT_BYTES, encoding: "utf8" },
        (error, stdout, stderr) =>
          error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout.trim()),
      );
    });
  }
}

function commitsFrom(output: string): OfficeCommit[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit = "", committedAt = "", ...subject] = line.split(FIELD);
      return { commit, committedAt: new Date(committedAt), subject: subject.join(FIELD) };
    });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
