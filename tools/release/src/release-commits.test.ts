import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { releaseCommits, type Commit } from "./release-commits.ts";
import { throwawayRepository, type ThrowawayRepository } from "./throwaway-repository.fixtures.ts";

let repository: ThrowawayRepository;
beforeEach(() => {
  repository = throwawayRepository();
});
afterEach(() => repository.remove());

/** Every commit in HEAD's history, newest first, as semantic-release hands them to plugins. */
function allCommits(): Commit[] {
  return repository
    .git("log", "--format=%H")
    .split("\n")
    .map((hash) => ({ hash }));
}

function subjectsCounted(lastReleaseTag?: string): string[] {
  return releaseCommits(allCommits(), { lastReleaseTag, cwd: repository.path }).map(({ hash }) =>
    repository.git("log", "-1", "--format=%s", hash),
  );
}

describe("the commits an Office release counts", () => {
  it("before the first release, counts only the commits after the one adding .releaserc.json", () => {
    repository.addReleaseConfig();
    assert.deepEqual(subjectsCounted(), []);

    repository.commit("feat: The Office installs from released versions");

    assert.deepEqual(subjectsCounted(), ["feat: The Office installs from released versions"]);
  });

  it("leaves out old commits merged in after the start, keeping the merge itself", () => {
    const beforeStart = repository.git("rev-parse", "HEAD");
    repository.addReleaseConfig();
    repository.git("switch", "--quiet", "-c", "older", beforeStart);
    repository.commit("feat: an old feature from main");
    repository.git("switch", "--quiet", "main");
    repository.git("merge", "--quiet", "--no-ff", "-m", "Merge main into the Initiative", "older");

    assert.deepEqual(subjectsCounted(), ["Merge main into the Initiative"]);
  });

  it("once a release is tagged, counts every commit as given", () => {
    repository.addReleaseConfig();
    repository.commit("feat: The Office installs from released versions");
    repository.git("tag", "v1.0.0");
    const given = allCommits();

    assert.deepEqual(
      releaseCommits(given, { lastReleaseTag: "v1.0.0", cwd: repository.path }),
      given,
    );
  });

  it("refuses a history with no release config", () => {
    assert.throws(() => subjectsCounted(), /No commit in HEAD's history adds \.releaserc\.json/);
  });
});
