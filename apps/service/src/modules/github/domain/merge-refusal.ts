import { fullNameOf, type RepositoryOnGitHub } from "./pull-request.js";

/** How GitHub lands a pull request's commits on its base: its `merge_method`s. */
export const GITHUB_MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type GitHubMergeMethod = (typeof GITHUB_MERGE_METHODS)[number];

/** A repository's merge settings as GitHub gives them; each left out unless the user may see it. */
export interface MergeSettingsOnGitHub {
  readonly allowMergeCommit: boolean | undefined;
  readonly allowSquashMerge: boolean | undefined;
  readonly allowRebaseMerge: boolean | undefined;
  readonly deleteBranchOnMerge: boolean | undefined;
}

/**
 * The merge methods the repository allows, in GITHUB_MERGE_METHODS' order. GitHub gives its
 * `allow_*` flags only to those who may change them; a flag left out offers its method, leaving
 * the refusal, if any, to GitHub.
 */
export function allowedMergeMethodsOf(settings: MergeSettingsOnGitHub): GitHubMergeMethod[] {
  const allowed: Record<GitHubMergeMethod, boolean | undefined> = {
    merge: settings.allowMergeCommit,
    squash: settings.allowSquashMerge,
    rebase: settings.allowRebaseMerge,
  };
  return GITHUB_MERGE_METHODS.filter((method) => allowed[method] !== false);
}

/** What GitHub answered a merge or close with: its status and the `message` it wrote, if any. */
export interface RefusalOnGitHub {
  readonly status: number;
  readonly message: string | undefined;
}

/** GitHub didn't merge or close the pull request; `message` says why, in the UI's words. */
export class PullRequestNotChanged extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PullRequestNotChanged";
  }
}

/**
 * GitHub refused as the pull request changed since The Office last read it (its head moved past
 * the commit The Office sent); reading it again and retrying may succeed.
 */
export class PullRequestChangedOnGitHub extends PullRequestNotChanged {
  constructor(number: number) {
    super(`#${number} changed on GitHub since The Office last read it. Refresh, then try again.`);
    this.name = "PullRequestChangedOnGitHub";
  }
}

/** The words for a call that got no answer from GitHub. */
export const GITHUB_UNREACHABLE = "GitHub couldn't be reached.";

/**
 * Why GitHub refused to merge pull request `number`
 * (docs.github.com/rest/pulls/pulls#merge-a-pull-request lists 403, 404, 405, 409 and 422), quoting
 * GitHub's own message where it gave one.
 */
export function mergeRefusal(
  refusal: RefusalOnGitHub,
  repository: RepositoryOnGitHub,
  number: number,
): PullRequestNotChanged {
  switch (refusal.status) {
    case 405:
      return new PullRequestNotChanged(withMessage(`GitHub won't merge #${number}`, refusal));
    case 409:
      return new PullRequestChangedOnGitHub(number);
    case 422:
      return new PullRequestNotChanged(withMessage("GitHub refused", refusal));
    case 401:
      return new PullRequestNotChanged(SIGN_IN_REFUSED);
    case 403:
    case 404:
      return new PullRequestNotChanged(
        `Your GitHub account can't merge in ${fullNameOf(repository)}.`,
      );
    default:
      return new PullRequestNotChanged(`GitHub didn't merge #${number} (HTTP ${refusal.status}).`);
  }
}

/** Why GitHub refused to close pull request `number` (docs.github.com/rest/pulls/pulls#update-a-pull-request). */
export function closeRefusal(
  refusal: RefusalOnGitHub,
  repository: RepositoryOnGitHub,
  number: number,
): PullRequestNotChanged {
  switch (refusal.status) {
    case 422:
      return new PullRequestNotChanged(withMessage("GitHub refused", refusal));
    case 401:
      return new PullRequestNotChanged(SIGN_IN_REFUSED);
    case 403:
    case 404:
      return new PullRequestNotChanged(
        `Your GitHub account can't close pull requests in ${fullNameOf(repository)}.`,
      );
    default:
      return new PullRequestNotChanged(`GitHub didn't close #${number} (HTTP ${refusal.status}).`);
  }
}

const SIGN_IN_REFUSED =
  "GitHub no longer accepts the sign-in. Sign in with GitHub again in Settings › Office identity.";

function withMessage(words: string, { message }: RefusalOnGitHub): string {
  return message === undefined || message.trim() === ""
    ? `${words}.`
    : `${words}: ${message.trim()}`;
}
