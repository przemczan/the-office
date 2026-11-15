import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import {
  commitsToCheck,
  NO_RELEASE_YET,
  subjectOf,
  type CommitsToCheck,
} from "./commits-to-check.ts";
import { failingCommits, loadMessageLinter, type MessageLinter } from "./conventional-commit.ts";
import { commitsBetween, newestRelease } from "./repository.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const NEW_BRANCH = "0".repeat(40);

let lintMessage: MessageLinter;
before(async () => {
  lintMessage = await loadMessageLinter(repositoryRoot);
});

function subjectsOf(checked: CommitsToCheck): string[] {
  return checked.commits.map((checkedCommit) => subjectOf(checkedCommit.message));
}

describe("check-commits on a push", () => {
  let repository: string;
  beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), "office-commit-check-"));
    git("init", "--quiet", "--initial-branch=main");
  });
  afterEach(() => rmSync(repository, { recursive: true, force: true }));

  function git(...args: string[]): string {
    const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];
    const unsigned = ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"];
    return execFileSync("git", [...identity, ...unsigned, ...args], {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  }

  function commit(message: string): string {
    git("commit", "--quiet", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  }

  function toCheck(from: string, to: string): CommitsToCheck {
    return commitsToCheck(commitsBetween(repository, from, to), newestRelease(repository, to));
  }

  it("checks nothing before the first release, and says why", () => {
    commit("Task 3 step 1: the queue");
    const head = commit("Implement: The Office follows the Project's own commit convention");

    assert.deepEqual(toCheck(NEW_BRANCH, head), { commits: [], reason: NO_RELEASE_YET });
  });

  it("skips the commits behind the newest release, even when the push holds them", () => {
    const start = commit("feat: first steps");
    commit("Task 3 step 1: the queue");
    commit("feat: the first release");
    git("tag", "v1.0.0");
    const head = commit("fix: a Task's Stage ends when its turn ends");

    const checked = toCheck(start, head);
    assert.deepEqual(subjectsOf(checked), ["fix: a Task's Stage ends when its turn ends"]);
    assert.equal("after" in checked && checked.after, "v1.0.0");
  });

  it("checks from the newest of several releases", () => {
    commit("feat: the first release");
    git("tag", "v1.0.0");
    commit("Old style after the first release");
    git("tag", "v1.1.0");
    const head = commit("docs: the commit rule");

    assert.deepEqual(subjectsOf(toCheck(NEW_BRANCH, head)), ["docs: the commit rule"]);
  });

  it("fails a commit after the release that isn't a Conventional Commit, and passes one that is", async () => {
    commit("feat: the first release");
    git("tag", "v1.0.0");
    const release = git("rev-parse", "HEAD");
    commit("Task 4 step 2: the release notes");
    const head = commit("feat(work): Tasks carry a commit message");

    const failures = await failingCommits(toCheck(release, head).commits, lintMessage);
    assert.deepEqual(
      failures.map((failure) => subjectOf(failure.commit.message)),
      ["Task 4 step 2: the release notes"],
    );
    assert.ok(failures[0]?.problems.some((problem) => problem.includes("[type-empty]")));
  });

  it("skips merge commits", () => {
    commit("feat: the first release");
    git("tag", "v1.0.0");
    const release = git("rev-parse", "HEAD");
    git("switch", "--quiet", "-c", "office/task");
    commit("fix: the queue starts the next Task");
    git("switch", "--quiet", "main");
    commit("docs: running The Office");
    git(
      "merge",
      "--quiet",
      "--no-ff",
      "-m",
      "Merge main from origin into office/task",
      "office/task",
    );
    const head = git("rev-parse", "HEAD");

    assert.deepEqual(subjectsOf(toCheck(release, head)).toSorted(), [
      "docs: running The Office",
      "fix: the queue starts the next Task",
    ]);
  });
});

describe("check-commits on a pull request's title and body", () => {
  it("passes a Conventional Commit, plain sentence and long link included", async () => {
    const body = `A Task's Publish squashes its Stage commits.\n\nSee https://example.com/${"long/".repeat(30)}`;
    assert.deepEqual(
      await lintMessage(`feat(pipelines): Publish makes one commit per Task\n\n${body}`),
      [],
    );
  });

  it("passes a breaking change", async () => {
    assert.deepEqual(await lintMessage("feat!: Projects need a Repository URL\n\n"), []);
  });

  it("fails a title without a type", async () => {
    const problems = await lintMessage("Task 4 step 2: the release notes\n\nThe body.");
    assert.ok(problems.some((problem) => problem.includes("[type-empty]")));
  });

  it("fails an unknown type", async () => {
    const problems = await lintMessage("feature: the release notes\n\n");
    assert.ok(problems.some((problem) => problem.includes("[type-enum]")));
  });
});
