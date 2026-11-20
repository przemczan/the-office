import { z } from "zod";
import type { ApiAnswer, FakeInstallations } from "./fake-github-installations.fixtures.js";

/** An issue on the fake GitHub, as a test names it; what it leaves out is defaulted. */
export interface FakeIssue {
  readonly number: number;
  readonly title?: string;
  /** Markdown; null as GitHub gives an issue with none, unless named. */
  readonly body?: string | null;
  /** Its author's login: `octocat` unless named. */
  readonly author?: string;
  readonly labels?: readonly string[];
  /** An ISO timestamp; a fixed day in 2026 plus its number of minutes unless named. */
  readonly createdAt?: string;
  readonly state?: "open" | "closed";
  readonly closedAt?: string | null;
  /** A pull request, which GitHub's issues API lists among the issues. */
  readonly pullRequest?: boolean;
}

/** What `setIssue` changes in an issue: anything but its number. */
export type FakeIssueChanges = Omit<FakeIssue, "number">;

/** A comment the fake GitHub took on an issue. */
export interface FakeIssueComment {
  readonly repository: string;
  readonly number: number;
  readonly body: string;
}

/** A close the fake GitHub took, with its `state_reason`. */
export interface FakeIssueClose {
  readonly repository: string;
  readonly number: number;
  readonly reason: string | null;
}

const issueFields = {
  title: z.string().optional(),
  body: z.string().nullable().optional(),
  author: z.string().optional(),
  labels: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  state: z.enum(["open", "closed"]).optional(),
  closedAt: z.string().nullable().optional(),
  pullRequest: z.boolean().optional(),
};

/**
 * Not GitHub's: the body of `POST /_fake/issues` (`FAKE_ISSUES_CONTROL_PATH`), one of the controls
 * below by its `action`, for a test that reaches the fake only over HTTP.
 */
export const issueControlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("addIssue"),
    repository: z.string().min(1),
    issue: z.object({ number: z.number().int().positive(), ...issueFields }),
  }),
  z.object({
    action: z.literal("setIssue"),
    repository: z.string().min(1),
    number: z.number().int().positive(),
    changes: z.object(issueFields),
  }),
]);
export type IssueControl = z.infer<typeof issueControlSchema>;

const updateSchema = z.object({
  state: z.enum(["open", "closed"]).optional(),
  state_reason: z.string().nullable().optional(),
});

const commentSchema = z.object({ body: z.string().min(1) });

interface StoredIssue {
  readonly number: number;
  title: string;
  body: string | null;
  author: string;
  labels: readonly string[];
  createdAt: string;
  state: "open" | "closed";
  closedAt: string | null;
  readonly pullRequest: boolean;
}

const FIRST_DAY = Date.parse("2026-01-05T09:00:00Z");

/** GitHub's page size when none is asked for, and the most it gives. */
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/**
 * Issues on the fake GitHub (docs.github.com/rest/issues): listing a repository's, pull requests
 * among them as GitHub does, by `state`, `labels` (any case), `sort=created` and `direction`, paged
 * with a `Link` header; reading one; commenting on one and closing it, which need the
 * installation's `issues: write` and are 403 without it. A repository no installation reaches is
 * 404.
 */
export class FakeIssues {
  private readonly issues = new Map<string, StoredIssue[]>();
  /** Every comment taken, in order. */
  readonly comments: FakeIssueComment[] = [];
  /** Every close taken, in order. */
  readonly closes: FakeIssueClose[] = [];

  constructor(
    private readonly web: string,
    private readonly installations: FakeInstallations,
  ) {}

  /** Adds an issue to the repository, as someone opening it on GitHub would. */
  addIssue(repository: string, issue: FakeIssue): void {
    const stored = this.issuesOf(repository);
    if (stored.some((each) => each.number === issue.number)) {
      throw new Error(`The fake GitHub already has #${issue.number} on ${repository}.`);
    }
    stored.push({
      number: issue.number,
      title: issue.title ?? `Issue ${issue.number}`,
      body: issue.body === undefined ? null : issue.body,
      author: issue.author ?? "octocat",
      labels: issue.labels ?? [],
      createdAt: issue.createdAt ?? new Date(FIRST_DAY + issue.number * 60_000).toISOString(),
      state: issue.state ?? "open",
      closedAt: issue.closedAt ?? null,
      pullRequest: issue.pullRequest ?? false,
    });
  }

  /** Changes issue `number`, such as closing it on GitHub. Throws for one not added. */
  setIssue(repository: string, number: number, changes: FakeIssueChanges): void {
    const issue = this.existing(repository, number);
    if (changes.title !== undefined) issue.title = changes.title;
    if (changes.body !== undefined) issue.body = changes.body;
    if (changes.author !== undefined) issue.author = changes.author;
    if (changes.labels !== undefined) issue.labels = changes.labels;
    if (changes.createdAt !== undefined) issue.createdAt = changes.createdAt;
    if (changes.state !== undefined) {
      issue.state = changes.state;
      issue.closedAt = changes.state === "closed" ? new Date().toISOString() : null;
    }
    if (changes.closedAt !== undefined) issue.closedAt = changes.closedAt;
  }

  /** Applies a control posted to `/_fake/issues`. */
  control(control: IssueControl): void {
    if (control.action === "addIssue") this.addIssue(control.repository, control.issue);
    else this.setIssue(control.repository, control.number, control.changes);
  }

  /** `GET /repos/{owner}/{repo}/issues`, `request` being the URL under the API's base. */
  list(repository: string, request: URL): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    const state = request.searchParams.get("state") ?? "open";
    const labels = (request.searchParams.get("labels") ?? "")
      .split(",")
      .map((label) => label.trim().toLowerCase())
      .filter((label) => label !== "");
    const ascending = request.searchParams.get("direction") === "asc";
    const listed = this.issuesOf(repository)
      .filter((issue) => state === "all" || issue.state === state)
      .filter((issue) =>
        labels.every((label) => issue.labels.some((each) => each.toLowerCase() === label)),
      )
      .toSorted(
        (one, other) =>
          (Date.parse(one.createdAt) - Date.parse(other.createdAt)) * (ascending ? 1 : -1),
      );
    return pageOf(request, listed, (page) => page.map((issue) => this.toJson(repository, issue)));
  }

  /** `GET /repos/{owner}/{repo}/issues/{number}`. */
  get(repository: string, number: number): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    const issue = this.issuesOf(repository).find((each) => each.number === number);
    if (issue === undefined) return notFound();
    return { status: 200, body: this.toJson(repository, issue) };
  }

  /** `POST /repos/{owner}/{repo}/issues/{number}/comments`. */
  comment(repository: string, number: number, body: string): ApiAnswer {
    const refusal = this.refusingWrite(repository, number);
    if (refusal !== undefined) return refusal;
    const parsed = commentSchema.safeParse(JSON.parse(body || "null"));
    if (!parsed.success) return { status: 422, body: { message: "Validation Failed" } };
    this.comments.push({ repository, number, body: parsed.data.body });
    return { status: 201, body: { id: this.comments.length, body: parsed.data.body } };
  }

  /** `PATCH /repos/{owner}/{repo}/issues/{number}`: only `state` and `state_reason` are read. */
  update(repository: string, number: number, body: string): ApiAnswer {
    const refusal = this.refusingWrite(repository, number);
    if (refusal !== undefined) return refusal;
    const parsed = updateSchema.safeParse(JSON.parse(body || "null"));
    if (!parsed.success) return { status: 422, body: { message: "Validation Failed" } };
    const issue = this.existing(repository, number);
    if (parsed.data.state === "closed") {
      this.closes.push({ repository, number, reason: parsed.data.state_reason ?? null });
      if (issue.state !== "closed") {
        issue.state = "closed";
        issue.closedAt = new Date().toISOString();
      }
    } else if (parsed.data.state === "open") {
      issue.state = "open";
      issue.closedAt = null;
    }
    return { status: 200, body: this.toJson(repository, issue) };
  }

  /** What the comments and closes taken were, for `GET /_fake/issues`. */
  writes(): { comments: readonly FakeIssueComment[]; closes: readonly FakeIssueClose[] } {
    return { comments: this.comments, closes: this.closes };
  }

  private refusingWrite(repository: string, number: number): ApiAnswer | undefined {
    if (!this.installations.reaches(repository)) return notFound();
    if (!this.issuesOf(repository).some((issue) => issue.number === number)) return notFound();
    if (!this.installations.grants(repository, "issues", "write")) {
      return { status: 403, body: { message: "Resource not accessible by integration" } };
    }
    return undefined;
  }

  private issuesOf(repository: string): StoredIssue[] {
    const key = repository.toLowerCase();
    let stored = this.issues.get(key);
    if (stored === undefined) {
      stored = [];
      this.issues.set(key, stored);
    }
    return stored;
  }

  private existing(repository: string, number: number): StoredIssue {
    const issue = this.issuesOf(repository).find((each) => each.number === number);
    if (issue === undefined) throw new Error(`The fake GitHub has no #${number} on ${repository}.`);
    return issue;
  }

  private toJson(repository: string, issue: StoredIssue): unknown {
    const kind = issue.pullRequest ? "pull" : "issues";
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      html_url: `${this.web}/${repository}/${kind}/${issue.number}`,
      user: { login: issue.author, html_url: `${this.web}/${issue.author}` },
      labels: issue.labels.map((name) => ({ name, color: "ededed" })),
      created_at: issue.createdAt,
      state: issue.state,
      closed_at: issue.closedAt,
      ...(issue.pullRequest && {
        pull_request: { url: `${this.web}/${repository}/pull/${issue.number}` },
      }),
    };
  }
}

/** One page of `all` by GitHub's `per_page` and `page`, with a `Link` header naming the next. */
function pageOf<T>(
  request: URL,
  all: readonly T[],
  bodyOf: (items: readonly T[]) => unknown,
): ApiAnswer {
  const size = Math.min(
    Number(request.searchParams.get("per_page") ?? DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const number = Number(request.searchParams.get("page") ?? 1);
  const body = bodyOf(all.slice((number - 1) * size, number * size));
  const last = Math.max(1, Math.ceil(all.length / size));
  if (number >= last) return { status: 200, body };
  const linkTo = (page: number, rel: string): string => {
    const url = new URL(request);
    url.searchParams.set("page", String(page));
    return `<${url.href}>; rel="${rel}"`;
  };
  return {
    status: 200,
    body,
    headers: { link: [linkTo(number + 1, "next"), linkTo(last, "last")].join(", ") },
  };
}

function notFound(): ApiAnswer {
  return { status: 404, body: { message: "Not Found" } };
}
