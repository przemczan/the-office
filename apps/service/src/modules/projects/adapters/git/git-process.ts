import { execFile } from "node:child_process";
import type { OfficeIdentity } from "../../../../platform/git-identity/office-identity.js";
import { GitCommandFailed, type GitVariables } from "../../ports/git.js";

const LOCAL_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

export interface GitCall {
  readonly folder: string;
  readonly gitArguments: readonly string[];
  /**
   * The URL or path the command reaches, as git resolves it (`insteadOf` applied); none for a
   * command that reaches no remote.
   */
  readonly remote?: string;
  /**
   * A Project's variables, for a call that may run its hooks and filters. Calls that only read
   * git's records run with the service's own, with git's messages in English, as the UI shows them.
   */
  readonly variables?: GitVariables;
  /** How long git may run; 0 for no limit, for a command only `signal` ends. */
  readonly timeoutMs?: number;
  /** Written to git's standard input. */
  readonly input?: string;
  /** Ends git when aborted. */
  readonly signal?: AbortSignal;
  /** Called with what git writes to standard error as it writes it, such as `--progress`. */
  readonly onStandardError?: (text: string) => void;
}

/** What git printed and how it exited; a git that couldn't start at all throws instead. */
export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the git on PATH, never through a shell, so no argument is ever parsed as a command; every
 * command on the Office identity, since even one that reaches no remote runs hooks and filters.
 */
export class GitProcess {
  constructor(private readonly identity: OfficeIdentity) {}

  /** Runs git and returns what it printed, or throws GitCommandFailed when it fails. */
  async output(call: GitCall): Promise<string> {
    const result = await this.run(call);
    if (result.exitCode !== 0) {
      throw new GitCommandFailed(call.gitArguments, result.exitCode, result.stderr.trim());
    }
    return result.stdout;
  }

  async run({
    folder,
    gitArguments,
    remote,
    variables,
    timeoutMs = LOCAL_TIMEOUT_MS,
    input,
    signal,
    onStandardError,
  }: GitCall): Promise<GitResult> {
    const identity = await this.identity.forGitCommand(
      remote,
      variables ?? { ...process.env, LC_ALL: "C" },
    );
    return new Promise<GitResult>((resolvePromise, reject) => {
      const child = execFile(
        "git",
        [...identity.configArguments, "-C", folder, ...gitArguments],
        {
          env: identity.variables,
          timeout: timeoutMs,
          ...(signal && { signal }),
          maxBuffer: OUTPUT_LIMIT_BYTES,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (!error) resolvePromise({ exitCode: 0, stdout, stderr });
          else if (typeof error.code === "number") {
            resolvePromise({ exitCode: error.code, stdout, stderr });
          } else {
            const reason = error.killed
              ? `git ${gitArguments[0] ?? ""} took longer than ${timeoutMs / 1000} s in ${folder}.`
              : `git could not run: ${error.message}`;
            reject(new Error(reason, { cause: error }));
          }
        },
      );
      if (onStandardError)
        child.stderr?.on("data", (chunk: Buffer | string) => onStandardError(String(chunk)));
      child.stdin?.end(input);
    }).finally(() => identity.release());
  }
}
