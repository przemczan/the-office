import { createHash } from "node:crypto";
import { z } from "zod";
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
  /** When it was merged, an ISO timestamp; null when it wasn't. */
  mergedAt: string | null;
  /** GitHub's `mergeable`: null while GitHub is working it out; true unless a test says otherwise. */
  mergeable: boolean | null;
  /** The commit its branch is at; `pushHead` moves it. */
  headSha: string;
  readonly baseSha: string;
}

/** A check run on a commit, as GitHub gives it. */
export interface FakeCheckRun {
  readonly name?: string;
  readonly status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  readonly conclusion?: string | null;
}

/** A commit status, as GitHub gives it. */
export interface FakeCommitStatus {
  readonly context?: string;
  readonly state: "error" | "failure" | "pending" | "success";
}

/**
 * A commit's checks: one word for the usual cases (one check run, and for `passing` and `failing`
 * a commit status beside it), or the check runs and statuses themselves.
 */
export type FakeChecks =
  | "passing"
  | "failing"
  | "pending"
  | "none"
  | {
      readonly runs?: readonly FakeCheckRun[];
      readonly statuses?: readonly FakeCommitStatus[];
    };

const checkRunSchema = z.object({
  name: z.string().optional(),
  status: z.enum(["queued", "in_progress", "completed", "waiting", "requested", "pending"]),
  conclusion: z.string().nullish(),
});
const commitStatusSchema = z.object({
  context: z.string().optional(),
  state: z.enum(["error", "failure", "pending", "success"]),
});
const fakeChecksSchema = z.union([
  z.enum(["passing", "failing", "pending", "none"]),
  z.object({
    runs: z.array(checkRunSchema).optional(),
    statuses: z.array(commitStatusSchema).optional(),
  }),
]);

const pullRequestOf = { repository: z.string().min(1), number: z.number().int().positive() };

/**
 * Not GitHub's: the body of `POST /_fake/pull-requests` (`FAKE_PULL_REQUESTS_CONTROL_PATH`), one
 * of the controls below by its `action`, for a test that reaches the fake only over HTTP.
 */
export const pullRequestControlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setChecks"), ...pullRequestOf, checks: fakeChecksSchema }),
  z.object({
    action: z.literal("setMergeable"),
    ...pullRequestOf,
    mergeable: z.boolean().nullable(),
  }),
  z.object({ action: z.literal("merge"), ...pullRequestOf }),
  z.object({ action: z.literal("close"), ...pullRequestOf }),
  z.object({ action: z.literal("pushHead"), ...pullRequestOf }),
  z.object({
    action: z.literal("refuseChecks"),
    repository: z.string().min(1),
    refused: z.boolean().default(true),
  }),
]);
export type PullRequestControl = z.infer<typeof pullRequestControlSchema>;

/**
 * Pull requests on the fake GitHub (docs.github.com/rest/pulls/pulls): opening one in a repository
 * an installation reaches, listing them by `state`, `head` (`owner:branch`) and `base`, reading one,
 * and the check runs and combined status of a commit. A repository no installation reaches is 404,
 * as GitHub hides what a token can't see. The 422s carry GitHub's validation errors as it words
 * them; the docs give only the status. Tests change a pull request with the controls below, the
 * way pushing, CI, merging and closing would on GitHub.
 */
export class FakePullRequests {
  readonly opened: FakePullRequest[] = [];
  /** Branches with no commits the base lacks, by `head`, which GitHub refuses to open. */
  readonly withoutCommits = new Set<string>();
  /** Repositories whose checks and statuses GitHub refuses (403), as without the permissions. */
  readonly checksRefused = new Set<string>();
  private readonly checksBySha = new Map<string, FakeChecks>();
  private pushes = 0;

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
      mergedAt: null,
      mergeable: true,
      headSha: this.nextSha(`${repository}:${head}`),
      baseSha: shaOf(`${repository}:${base}`),
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

  /** `GET /repos/{owner}/{repo}/pulls/{number}`. */
  get(repository: string, number: number): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    const pullRequest = this.find(repository, number);
    return pullRequest === undefined ? notFound() : { status: 200, body: this.toJson(pullRequest) };
  }

  /** `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`; one page holds them all. */
  checkRuns(repository: string, sha: string): ApiAnswer {
    const refused = this.refusal(repository);
    if (refused !== undefined) return refused;
    const runs = runsOf(this.checksBySha.get(sha) ?? "none");
    return {
      status: 200,
      body: {
        total_count: runs.length,
        check_runs: runs.map((run, index) => ({
          id: index + 1,
          head_sha: sha,
          name: run.name ?? `check ${index + 1}`,
          status: run.status,
          conclusion: run.conclusion ?? null,
        })),
      },
    };
  }

  /**
   * `GET /repos/{owner}/{repo}/commits/{ref}/status`: as GitHub, its `state` is `pending` for a
   * commit without statuses.
   */
  combinedStatus(repository: string, sha: string): ApiAnswer {
    const refused = this.refusal(repository);
    if (refused !== undefined) return refused;
    const statuses = statusesOf(this.checksBySha.get(sha) ?? "none");
    const states = statuses.map((status) => status.state);
    const state =
      states.length === 0 || states.includes("pending")
        ? "pending"
        : states.some((each) => each === "failure" || each === "error")
          ? "failure"
          : "success";
    return {
      status: 200,
      body: {
        state,
        sha,
        total_count: statuses.length,
        statuses: statuses.map((status, index) => ({
          context: status.context ?? `status ${index + 1}`,
          state: status.state,
        })),
      },
    };
  }

  /** The checks of pull request `number`'s head commit now. Throws for a pull request not opened. */
  setChecks(repository: string, number: number, checks: FakeChecks): void {
    this.checksBySha.set(this.existing(repository, number).headSha, checks);
  }

  setMergeable(repository: string, number: number, mergeable: boolean | null): void {
    this.existing(repository, number).mergeable = mergeable;
  }

  /** Merged on GitHub: closed, with `merged_at`. */
  merge(repository: string, number: number): void {
    const pullRequest = this.existing(repository, number);
    pullRequest.state = "closed";
    pullRequest.mergedAt = new Date().toISOString();
  }

  /** Closed on GitHub without merging. */
  close(repository: string, number: number): void {
    this.existing(repository, number).state = "closed";
  }

  /** A new commit pushed to the pull request's branch: its head moves, with no checks yet. */
  pushHead(repository: string, number: number): void {
    const pullRequest = this.existing(repository, number);
    pullRequest.headSha = this.nextSha(`${repository}:${pullRequest.head}`);
  }

  /** Applies a control posted to `/_fake/pull-requests`. */
  control(control: PullRequestControl): void {
    switch (control.action) {
      case "setChecks":
        this.setChecks(control.repository, control.number, control.checks);
        return;
      case "setMergeable":
        this.setMergeable(control.repository, control.number, control.mergeable);
        return;
      case "merge":
        this.merge(control.repository, control.number);
        return;
      case "close":
        this.close(control.repository, control.number);
        return;
      case "pushHead":
        this.pushHead(control.repository, control.number);
        return;
      case "refuseChecks":
        if (control.refused) this.checksRefused.add(control.repository);
        else this.checksRefused.delete(control.repository);
        return;
    }
  }

  private refusal(repository: string): ApiAnswer | undefined {
    if (!this.installations.reaches(repository)) return notFound();
    if (!this.checksRefused.has(repository)) return undefined;
    return { status: 403, body: { message: "Resource not accessible by integration" } };
  }

  private find(repository: string, number: number): FakePullRequest | undefined {
    return this.opened.find(
      (pullRequest) => pullRequest.repository === repository && pullRequest.number === number,
    );
  }

  private existing(repository: string, number: number): FakePullRequest {
    const pullRequest = this.find(repository, number);
    if (pullRequest === undefined) {
      throw new Error(`The fake GitHub has no pull request #${number} on ${repository}.`);
    }
    return pullRequest;
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

  private nextSha(seed: string): string {
    this.pushes += 1;
    return shaOf(`${seed}#${this.pushes}`);
  }

  private toJson(pullRequest: FakePullRequest): unknown {
    return {
      html_url: `${this.web}/${pullRequest.repository}/pull/${pullRequest.number}`,
      number: pullRequest.number,
      state: pullRequest.state,
      title: pullRequest.title,
      body: pullRequest.body ?? null,
      merged_at: pullRequest.mergedAt,
      mergeable: pullRequest.mergeable,
      head: { ref: pullRequest.head, sha: pullRequest.headSha },
      base: { ref: pullRequest.base, sha: pullRequest.baseSha },
    };
  }
}

function runsOf(checks: FakeChecks): readonly FakeCheckRun[] {
  switch (checks) {
    case "passing":
      return [{ status: "completed", conclusion: "success" }];
    case "failing":
      return [{ status: "completed", conclusion: "failure" }];
    case "pending":
      return [{ status: "in_progress" }];
    case "none":
      return [];
    default:
      return checks.runs ?? [];
  }
}

function statusesOf(checks: FakeChecks): readonly FakeCommitStatus[] {
  switch (checks) {
    case "passing":
      return [{ state: "success" }];
    case "failing":
      return [{ state: "failure" }];
    case "pending":
    case "none":
      return [];
    default:
      return checks.statuses ?? [];
  }
}

/** A commit's id, as GitHub's 40 hex digits. */
function shaOf(seed: string): string {
  return createHash("sha1").update(seed).digest("hex");
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
