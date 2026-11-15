// semantic-release itself, in a dry run on a throwaway repository, with the root .releaserc.json's
// first-release plugin and config: what version and notes the first releases get.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import semanticRelease from "semantic-release";
import { OLD_HISTORY, throwawayRepository } from "../src/throwaway-repository.fixtures.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const releaseConfig = JSON.parse(readFileSync(join(repositoryRoot, ".releaserc.json"), "utf8"));
const [[, firstReleaseConfig]] = releaseConfig.plugins;
const FIRST_RELEASE_PLUGIN = join(import.meta.dirname, "first-release.mjs");

let repository;
let remote;
beforeEach(() => {
  repository = throwawayRepository();
  remote = join(repository.path, ".git", "remote.git");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", remote]);
  repository.git("remote", "add", "origin", remote);
});
afterEach(() => repository.remove());

/** What semantic-release would release from the throwaway repository's main now; false for nothing. */
async function wouldRelease() {
  repository.git("push", "--quiet", "--tags", "origin", "main");
  let output = "";
  const log = new Writable({
    write(chunk, _encoding, done) {
      output += chunk;
      done();
    },
  });
  const options = {
    dryRun: true,
    ci: false,
    branches: releaseConfig.branches,
    tagFormat: releaseConfig.tagFormat,
    // A URL, as the notes generator parses it to link the commits.
    repositoryUrl: pathToFileURL(remote).href,
    plugins: [[FIRST_RELEASE_PLUGIN, firstReleaseConfig]],
  };
  const environment = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1" };
  try {
    const result = await semanticRelease(options, {
      cwd: repository.path,
      env: environment,
      stdout: log,
      stderr: log,
    });
    return result && { version: result.nextRelease.version, notes: result.nextRelease.notes };
  } catch (error) {
    throw new Error(`semantic-release failed: ${error}\n${output}`, { cause: error });
  }
}

describe("the first Office release", () => {
  it("releases nothing from the history before .releaserc.json, and 1.0.0 from one feat after it", async () => {
    repository.addReleaseConfig();
    repository.commit("Implement: Self-update from released versions");
    assert.equal(await wouldRelease(), false);

    repository.commit(
      "feat: The Office installs from released versions, as a tarball or a container image",
    );
    repository.commit("docs: how to release");
    const release = await wouldRelease();

    assert.equal(release.version, "1.0.0");
    assert.match(release.notes, /### Features/);
    assert.match(release.notes, /The Office installs from released versions, as a tarball/);
    for (const subject of [...OLD_HISTORY, "how to release", "Implement:"]) {
      assert.doesNotMatch(release.notes, new RegExp(subject));
    }
  });

  it("leaves out old commits merged in after .releaserc.json", async () => {
    const beforeStart = repository.git("rev-parse", "HEAD");
    repository.addReleaseConfig();
    repository.git("switch", "--quiet", "-c", "older", beforeStart);
    repository.commit("feat: an old feature from main");
    repository.git("switch", "--quiet", "main");
    repository.git("merge", "--quiet", "--no-ff", "-m", "Merge main into the Initiative", "older");

    assert.equal(await wouldRelease(), false);
  });

  it("after a release, counts each commit since its tag, a refactor as a patch", async () => {
    repository.addReleaseConfig();
    repository.commit("feat: The Office installs from released versions");
    repository.git("tag", "v1.0.0");
    repository.commit("refactor(pipelines): the Stage interpreter walks one Task at a time");
    const release = await wouldRelease();

    assert.equal(release.version, "1.0.1");
    assert.match(release.notes, /### Refactoring/);
    assert.doesNotMatch(release.notes, /installs from released versions/);
  });
});
