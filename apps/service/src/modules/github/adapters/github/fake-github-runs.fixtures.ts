import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApiAnswer, FakeInstallations } from "./fake-github-installations.fixtures.js";

/** A GitHub Actions run on the fake GitHub, as a test names it; what it leaves out is defaulted. */
export interface FakeWorkflowRun {
  readonly id: number;
  /** The workflow's name; `CI` unless named. */
  readonly name?: string;
  /** GitHub's `display_title`: the commit message or pull request title; the name unless named. */
  readonly displayTitle?: string;
  readonly runNumber?: number;
  /** Starts at 1; each re-run adds one. */
  readonly runAttempt?: number;
  /** What started it: `push` unless named. */
  readonly event?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly headBranch?: string | null;
  readonly headSha?: string;
  /** An ISO timestamp, or null while it hasn't started. */
  readonly startedAt?: string | null;
  readonly updatedAt?: string;
}

/** What `setRun` changes in a run: anything but its id. */
export type FakeWorkflowRunChanges = Omit<FakeWorkflowRun, "id">;

const DEFAULT_TIME = "2026-01-05T09:00:00Z";

const runFields = {
  name: z.string().optional(),
  displayTitle: z.string().optional(),
  runNumber: z.number().int().optional(),
  runAttempt: z.number().int().optional(),
  event: z.string().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  headBranch: z.string().nullable().optional(),
  headSha: z.string().optional(),
  startedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
};

/**
 * Not GitHub's: the body of `POST /_fake/runs` (`FAKE_RUNS_CONTROL_PATH`), one of the controls below
 * by its `action`, for a test that reaches the fake only over HTTP.
 */
export const runControlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("addRun"),
    repository: z.string().min(1),
    run: z.object({ id: z.number().int(), ...runFields }),
  }),
  z.object({
    action: z.literal("setRun"),
    repository: z.string().min(1),
    id: z.number().int(),
    changes: z.object(runFields),
  }),
]);
export type RunControl = z.infer<typeof runControlSchema>;

interface StoredRun {
  readonly id: number;
  name: string;
  displayTitle: string;
  runNumber: number;
  runAttempt: number;
  event: string;
  status: string;
  conclusion: string | null;
  headBranch: string | null;
  headSha: string;
  startedAt: string | null;
  updatedAt: string;
}

/**
 * GitHub Actions runs on the fake GitHub (docs.github.com/rest/actions/workflow-runs): listing a
 * repository's newest first by `per_page`, and re-running one or only its failed jobs, which sends
 * it back to queued with its attempt counted up. A repository no installation reaches is 404; a
 * re-run needs the installation's `actions: write` permission, and is 403 without it.
 */
export class FakeWorkflowRuns {
  private readonly runs = new Map<string, StoredRun[]>();

  constructor(
    private readonly web: string,
    private readonly installations: FakeInstallations,
  ) {}

  /** Adds a run to the repository, which a test or `POST /_fake/runs` does as CI would. */
  addRun(repository: string, run: FakeWorkflowRun): void {
    const stored = this.runsOf(repository);
    if (stored.some((each) => each.id === run.id)) {
      throw new Error(`The fake GitHub already has run ${run.id} on ${repository}.`);
    }
    const name = run.name ?? "CI";
    stored.push({
      id: run.id,
      name,
      displayTitle: run.displayTitle ?? name,
      runNumber: run.runNumber ?? stored.length + 1,
      runAttempt: run.runAttempt ?? 1,
      event: run.event ?? "push",
      status: run.status ?? "completed",
      conclusion: run.conclusion === undefined ? "success" : run.conclusion,
      headBranch: run.headBranch === undefined ? "main" : run.headBranch,
      headSha: run.headSha ?? shaOf(`${repository}#${run.id}`),
      startedAt: run.startedAt === undefined ? DEFAULT_TIME : run.startedAt,
      updatedAt: run.updatedAt ?? DEFAULT_TIME,
    });
  }

  /** Changes run `id`. Throws for a run not added. */
  setRun(repository: string, id: number, changes: FakeWorkflowRunChanges): void {
    const run = this.existing(repository, id);
    if (changes.name !== undefined) run.name = changes.name;
    if (changes.displayTitle !== undefined) run.displayTitle = changes.displayTitle;
    if (changes.runNumber !== undefined) run.runNumber = changes.runNumber;
    if (changes.runAttempt !== undefined) run.runAttempt = changes.runAttempt;
    if (changes.event !== undefined) run.event = changes.event;
    if (changes.status !== undefined) run.status = changes.status;
    if (changes.conclusion !== undefined) run.conclusion = changes.conclusion;
    if (changes.headBranch !== undefined) run.headBranch = changes.headBranch;
    if (changes.headSha !== undefined) run.headSha = changes.headSha;
    if (changes.startedAt !== undefined) run.startedAt = changes.startedAt;
    if (changes.updatedAt !== undefined) run.updatedAt = changes.updatedAt;
  }

  /** The run a `workflow_dispatch` queues on `branch`, with an id no other run has. */
  queueDispatched(repository: string, name: string, branch: string): void {
    const ids = [...this.runs.values()].flat().map((run) => run.id);
    this.addRun(repository, {
      id: Math.max(0, ...ids) + 1,
      name,
      event: "workflow_dispatch",
      status: "queued",
      conclusion: null,
      headBranch: branch,
      startedAt: null,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Applies a control posted to `/_fake/runs`. */
  control(control: RunControl): void {
    if (control.action === "addRun") this.addRun(control.repository, control.run);
    else this.setRun(control.repository, control.id, control.changes);
  }

  /** `GET /repos/{owner}/{repo}/actions/runs`, `request` being the URL under the API's base. */
  list(repository: string, request: URL): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    const size = Math.min(Number(request.searchParams.get("per_page") ?? 30), 100);
    const newestFirst = this.runsOf(repository).toReversed();
    return {
      status: 200,
      body: {
        total_count: newestFirst.length,
        workflow_runs: newestFirst.slice(0, size).map((run) => this.toJson(repository, run)),
      },
    };
  }

  /** `POST /repos/{owner}/{repo}/actions/runs/{id}/rerun` and `…/rerun-failed-jobs`. */
  rerun(repository: string, id: number): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    if (!this.installations.grants(repository, "actions", "write")) {
      return { status: 403, body: { message: "Resource not accessible by integration" } };
    }
    const run = this.runsOf(repository).find((each) => each.id === id);
    if (run === undefined) return notFound();
    if (run.status !== "completed") {
      return { status: 403, body: { message: "Workflow is already running." } };
    }
    run.status = "queued";
    run.conclusion = null;
    run.runAttempt += 1;
    return { status: 201, body: {} };
  }

  private runsOf(repository: string): StoredRun[] {
    const key = repository.toLowerCase();
    let stored = this.runs.get(key);
    if (stored === undefined) {
      stored = [];
      this.runs.set(key, stored);
    }
    return stored;
  }

  private existing(repository: string, id: number): StoredRun {
    const run = this.runsOf(repository).find((each) => each.id === id);
    if (run === undefined) {
      throw new Error(`The fake GitHub has no run ${id} on ${repository}.`);
    }
    return run;
  }

  private toJson(repository: string, run: StoredRun): unknown {
    return {
      id: run.id,
      name: run.name,
      display_title: run.displayTitle,
      run_number: run.runNumber,
      run_attempt: run.runAttempt,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      head_branch: run.headBranch,
      head_sha: run.headSha,
      html_url: `${this.web}/${repository}/actions/runs/${run.id}`,
      run_started_at: run.startedAt,
      updated_at: run.updatedAt,
    };
  }
}

function shaOf(seed: string): string {
  return createHash("sha1").update(seed).digest("hex");
}

function notFound(): ApiAnswer {
  return { status: 404, body: { message: "Not Found" } };
}
