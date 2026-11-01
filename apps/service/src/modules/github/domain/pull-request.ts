/** A repository on GitHub, by its owner's login and its name. */
export interface RepositoryOnGitHub {
  readonly owner: string;
  readonly name: string;
}

/** A pull request to open: `head`, a branch of the same repository, into `base`. */
export interface PullRequestToOpen {
  readonly repository: RepositoryOnGitHub;
  readonly base: string;
  readonly head: string;
  readonly title: string;
  /** Markdown. */
  readonly body: string;
}

/** GitHub didn't open the pull request; `message` says why, in the UI's words. */
export class PullRequestNotOpened extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PullRequestNotOpened";
  }
}

const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const SSH_PROTOCOLS: ReadonlySet<string> = new Set(["ssh:", "git+ssh:", "ssh+git:"]);
/** git's scp-like syntax, `[user@]host:path`. */
const SCP_LIKE = /^(?:[^@/]+@)?([^:/[\]]+):(.+)$/;

/**
 * The repository on GitHub a remote's URL names, or undefined when it names none: an http(s) URL on
 * GitHub's website (`webUrl`, matched by origin, as the identity's credential helper matches it),
 * or an ssh URL or `user@host:path` on its host.
 */
export function repositoryOnGitHubOf(
  remoteUrl: string,
  webUrl: string,
): RepositoryOnGitHub | undefined {
  const path = pathOnGitHub(remoteUrl, new URL(webUrl));
  if (path === undefined) return undefined;
  const [owner, name, ...rest] = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  if (!owner || !name || rest.length > 0) return undefined;
  return { owner, name };
}

/** `owner/name`, as GitHub writes a repository. */
export function fullNameOf({ owner, name }: RepositoryOnGitHub): string {
  return `${owner}/${name}`;
}

/**
 * Why GitHub refused to open the pull request, from its status and the messages of a 422's
 * validation errors (docs.github.com/rest/pulls/pulls#create-a-pull-request lists 403 and 422).
 */
export function pullRequestRefusal(
  status: number,
  reasons: readonly string[],
  pullRequest: PullRequestToOpen,
): string {
  const repository = fullNameOf(pullRequest.repository);
  switch (status) {
    case 401:
      return "GitHub no longer accepts the sign-in, so the pull request wasn't opened. Sign in with GitHub again in Settings › Office identity.";
    case 403:
      return `GitHub refused to open the pull request on ${repository} (HTTP 403): the GitHub App needs its Pull requests permission there, and the signed-in user write access to the repository.`;
    case 404:
      return `GitHub doesn't show ${repository} to the signed-in user (HTTP 404). Install the GitHub App on it from Settings › Office identity.`;
    case 422:
      return reasons.length > 0
        ? `GitHub didn't open the pull request of ${pullRequest.head} into ${pullRequest.base}: ${reasons.join(" ")}`
        : `GitHub didn't open the pull request of ${pullRequest.head} into ${pullRequest.base} (HTTP 422): check that ${pullRequest.base} exists on ${repository}.`;
    default:
      return `GitHub didn't open the pull request on ${repository} (HTTP ${status}).`;
  }
}

function pathOnGitHub(remoteUrl: string, web: URL): string | undefined {
  if (URL_SCHEME.test(remoteUrl)) {
    if (!URL.canParse(remoteUrl)) return undefined;
    const url = new URL(remoteUrl);
    const onGitHub = SSH_PROTOCOLS.has(url.protocol)
      ? url.hostname.toLowerCase() === web.hostname
      : url.origin === web.origin;
    return onGitHub ? url.pathname : undefined;
  }
  const scpLike = SCP_LIKE.exec(remoteUrl);
  return scpLike?.[1]?.toLowerCase() === web.hostname ? scpLike[2] : undefined;
}
