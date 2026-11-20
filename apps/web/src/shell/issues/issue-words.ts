import type { IssueImportResult, OpenIssue, Project } from "@the-office/contracts";
import { ApiError } from "../../api/api-client.ts";
import { dayOf, durationWords, sameDay } from "../time.ts";

/** At most this many are imported at a time, as the service takes (`issueImportSchema`). */
export const MOST_PICKED = 50;

/** The service lists at most this many open issues, newest first. */
export const MOST_LISTED = 500;

/** Why a row can't be picked once `MOST_PICKED` are. */
export const PICKED_ENOUGH = `Import these ${MOST_PICKED} first: at most ${MOST_PICKED} at a time.`;

/** The refusal that sends the user to sign in, as the service words it. */
export const SIGN_IN_TO_IMPORT =
  "Sign in with GitHub in Settings › Office identity to import issues.";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where Import issues… imports from the Work board: the Projects whose repository is on a code
 * host (GitHub today), which its picker lists, starting on the first one `shown`; undefined when
 * no Project shown is on one, and the button doesn't show.
 */
export function issueImportOf(
  projects: readonly Project[],
  shown: (projectId: string) => boolean,
): { readonly projects: readonly Project[]; readonly projectId: string } | undefined {
  const onCodeHost = projects.filter(({ codeHost }) => codeHost !== null);
  const first = onCodeHost.find(({ id }) => shown(id));
  return first && { projects: onCodeHost, projectId: first.id };
}

/** The issues whose title, number, label or author holds every word of the search. */
export function issuesMatching(issues: readonly OpenIssue[], search: string): OpenIssue[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...issues];
  return issues.filter((issue) => {
    const text = [issue.title, `#${issue.number}`, issue.author.login, ...issue.labels]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** "opened by octocat, 2 hours ago": within a day by the hour, then yesterday, days, the date. */
export function openedWords(issue: Pick<OpenIssue, "author" | "openedAt">, now: Date): string {
  return `opened by ${issue.author.login}, ${whenWords(issue.openedAt, now)}`;
}

function whenWords(isoTime: string, now: Date): string {
  const since = Math.max(0, now.getTime() - new Date(isoTime).getTime());
  if (since < DAY_MS) return `${durationWords(since)} ago`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(isoTime, yesterday)) return "yesterday";
  const days = Math.floor(since / DAY_MS);
  return days < 7 ? `${days} days ago` : dayOf(isoTime, now);
}

/** "ptelazka/the-office", read from an issue's address on GitHub; undefined when it isn't one. */
export function repositoryOfIssue(url: string): string | undefined {
  const match = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/issues\/\d+/.exec(url);
  return match?.[1];
}

/** The repository's issues page, where older ones are searched. */
export function issuesPageOf(url: string): string | undefined {
  const match = /^(https?:\/\/[^/]+\/[^/]+\/[^/]+\/issues)\/\d+/.exec(url);
  return match?.[1];
}

/** "15 open issues not yet imported", "1 open issue not yet imported". */
export function notImportedWords(count: number): string {
  return `${count} open ${count === 1 ? "issue" : "issues"} not yet imported`;
}

/** "Import 3 issues", "Import 1 issue". */
export function importWords(count: number): string {
  return count === 0 ? "Import issues" : `Import ${count} ${count === 1 ? "issue" : "issues"}`;
}

/** The toast after an import: "3 Tasks added to Backlog." and each issue skipped, named. */
export function importedWords({ imported, skipped }: IssueImportResult): string {
  const added =
    imported.length === 0
      ? "No Task added."
      : `${imported.length} ${imported.length === 1 ? "Task" : "Tasks"} added to Backlog.`;
  return [added, ...skipped.map(({ why }) => why)].join(" ");
}

/** How a refusal to read the issues shows: the sign-in's with its link, any other as itself. */
export type IssuesRefusal =
  | { readonly kind: "sign-in" }
  | { readonly kind: "not-on-github"; readonly words: string }
  | { readonly kind: "failed"; readonly error: Error };

export function issuesRefusalOf(error: Error): IssuesRefusal {
  if (!(error instanceof ApiError) || error.status !== 422) return { kind: "failed", error };
  if (error.message === SIGN_IN_TO_IMPORT) return { kind: "sign-in" };
  return { kind: "not-on-github", words: error.message };
}
