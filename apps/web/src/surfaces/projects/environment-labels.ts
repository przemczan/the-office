import type {
  CommandCheck,
  CommandRun,
  EnvironmentCheck,
  Project,
  ProjectEnvironment,
  WorktreeCheck,
} from "@the-office/contracts";
import { COMMAND_LABELS } from "../../shell/project-words.ts";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/** The block's badge: how the Project's last environment check went. */
export function checkBadge(check: EnvironmentCheck | null | undefined): {
  readonly tone: Tone;
  readonly label: string;
} {
  switch (check?.state) {
    case undefined:
      return { tone: "neutral", label: "Not checked" };
    case "running":
      return { tone: "info", label: "Checking" };
    case "passed":
      return { tone: "success", label: "Ready" };
    case "failed":
      return { tone: "danger", label: "Failed" };
    case "stopped":
      return { tone: "warning", label: "Stopped" };
  }
}

/** "A fresh worktree of origin/main", or of the local branch when it tracks none. */
export function worktreeCheckLabel(check: WorktreeCheck, project: Project): string {
  if (check.base?.fetchedFrom) return `A fresh worktree of ${check.base.fetchedFrom}`;
  if (check.base) return `A worktree of ${project.baseBranch}, which tracks no remote branch`;
  return `A fresh worktree of ${project.baseBranch}`;
}

/** What a finished worktree check adds: its commit, or git's words. */
export function worktreeCheckDetail(check: WorktreeCheck): string | undefined {
  if (check.problem !== undefined) return check.problem;
  return check.base && `at ${check.base.commit.slice(0, 7)}`;
}

export function commandCheckLabel(check: CommandCheck): string {
  return COMMAND_LABELS[check.step];
}

/** How a command's run ended, in a few words: "passed in 12 s", "failed with exit code 2". */
export function runSummary(run: CommandRun): string {
  const took = formatDuration(run.durationMs);
  switch (run.outcome) {
    case "passed":
      return `passed in ${took}`;
    case "failed":
      return run.exitCode === undefined
        ? `failed after ${took}`
        : `failed with exit code ${run.exitCode}`;
    case "could-not-run":
      return "could not run: is its program installed and on PATH?";
    case "timed-out":
      return `ran out of time after ${took}`;
    case "stopped":
      return "stopped when The Office shut down";
  }
}

/** "0.4 s", "12 s", "3 min 5 s". */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${(durationMs / 1000).toFixed(1)} s`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** The environment as the editor shows it: one `NAME=value` and one folder per line. */
export interface EnvironmentDraft {
  readonly set: string;
  readonly unset: string;
  readonly prependPath: string;
}

export function draftOf(environment: ProjectEnvironment): EnvironmentDraft {
  return {
    set: environment.set.map(({ name, value }) => `${name}=${value}`).join("\n"),
    unset: environment.unset.join(", "),
    prependPath: environment.prependPath.join("\n"),
  };
}

/**
 * The environment the draft describes, or the lines it can't read. The service checks the
 * rest of the rules.
 */
export function environmentOf(
  draft: EnvironmentDraft,
): { readonly environment: ProjectEnvironment } | { readonly problems: readonly string[] } {
  const lines = draft.set.split(/\r?\n/).filter((line) => line.trim() !== "");
  const problems = lines
    .filter((line) => !line.includes("="))
    .map((line) => `Write each variable as NAME=value; "${line.trim()}" has no "=".`);
  if (problems.length > 0) return { problems };
  return {
    environment: {
      set: lines.map((line) => {
        const equals = line.indexOf("=");
        return { name: line.slice(0, equals), value: line.slice(equals + 1) };
      }),
      unset: draft.unset.split(","),
      prependPath: draft.prependPath.split(/\r?\n/),
    },
  };
}
