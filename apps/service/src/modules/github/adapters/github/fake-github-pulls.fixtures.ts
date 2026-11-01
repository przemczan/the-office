import type { ApiAnswer, FakeInstallations } from "./fake-github-installations.fixtures.js";

/** A pull request opened on the fake GitHub. */
export interface FakePullRequest {
  readonly repository: string;
  readonly number: number;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string | undefined;
  state: "open" | "closed";
}

/**
 * Pull requests on the fake GitHub (docs.github.com/rest/pulls/pulls): opening one in a repository
 * an installation reaches, and listing them by `state`, `head` (`owner:branch`) and `base`. A
 * repository no installation reaches is 404, as GitHub hides what a token can't see. The 422s
 * carry GitHub's validation errors as it words them; the docs give only the status.
 */
export class FakePullRequests {
  readonly opened: FakePullRequest[] = [];
  /** Branches with no commits the base lacks, by `head`, which GitHub refuses to open. */
  readonly withoutCommits = new Set<string>();

  constructor(
    private readonly web: string,
    private readonly installations: FakeInstallations,
  ) {}

  /** `POST /repos/{owner}/{repo}/pulls`. */
  open(repository: string, body: string): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    const asked = JSON.parse(body) as Partial<Record<"head" | "base" | "title" | "body", string>>;
    const { head, base, title } = asked;
    if (!head || !base || !title) return validationFailed({ code: "missing_field" });
    const owner = repository.split("/")[0];
    if (this.openFor(repository, head, base) !== undefined) {
      return validationFailed({
        code: "custom",
        message: `A pull request already exists for ${owner}:${head}.`,
      });
    }
    if (this.withoutCommits.has(head)) {
      return validationFailed({
        code: "custom",
        message: `No commits between ${base} and ${head}`,
      });
    }
    const pullRequest: FakePullRequest = {
      repository,
      number: this.opened.length + 1,
      head,
      base,
      title,
      body: asked.body,
      state: "open",
    };
    this.opened.push(pullRequest);
    return { status: 201, body: this.toJson(pullRequest) };
  }

  /** `GET /repos/{owner}/{repo}/pulls`, `request` being the URL under the API's base. */
  list(repository: string, request: URL): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    const state = request.searchParams.get("state") ?? "open";
    const head = request.searchParams.get("head");
    const base = request.searchParams.get("base");
    const listed = this.opened.filter(
      (pullRequest) =>
        pullRequest.repository === repository &&
        (state === "all" || pullRequest.state === state) &&
        (head === null || `${repository.split("/")[0]}:${pullRequest.head}` === head) &&
        (base === null || pullRequest.base === base),
    );
    return { status: 200, body: listed.map((pullRequest) => this.toJson(pullRequest)) };
  }

  private openFor(repository: string, head: string, base: string): FakePullRequest | undefined {
    return this.opened.find(
      (pullRequest) =>
        pullRequest.repository === repository &&
        pullRequest.head === head &&
        pullRequest.base === base &&
        pullRequest.state === "open",
    );
  }

  private toJson(pullRequest: FakePullRequest): unknown {
    return {
      html_url: `${this.web}/${pullRequest.repository}/pull/${pullRequest.number}`,
      number: pullRequest.number,
      state: pullRequest.state,
      title: pullRequest.title,
      body: pullRequest.body ?? null,
      head: { ref: pullRequest.head },
      base: { ref: pullRequest.base },
    };
  }
}

function notFound(): ApiAnswer {
  return { status: 404, body: { message: "Not Found" } };
}

function validationFailed(error: { code: string; message?: string }): ApiAnswer {
  return {
    status: 422,
    body: { message: "Validation Failed", errors: [{ resource: "PullRequest", ...error }] },
  };
}
