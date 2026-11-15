// A semantic-release plugin in place of commit-analyzer and release-notes-generator: it calls them
// with only the commits that count for the release (tools/release/src/release-commits.ts), so the
// history from before releases neither raises the first version nor shows in its notes. Its
// config is theirs, passed through.
import * as commitAnalyzer from "@semantic-release/commit-analyzer";
import * as releaseNotesGenerator from "@semantic-release/release-notes-generator";
import { releaseCommits } from "../src/release-commits.ts";

export function analyzeCommits(pluginConfig, context) {
  return commitAnalyzer.analyzeCommits(pluginConfig, withReleaseCommits(context));
}

export function generateNotes(pluginConfig, context) {
  return releaseNotesGenerator.generateNotes(pluginConfig, withReleaseCommits(context));
}

function withReleaseCommits(context) {
  const commits = releaseCommits(context.commits, {
    lastReleaseTag: context.lastRelease?.gitTag || undefined,
    cwd: context.cwd,
  });
  const leftOut = context.commits.length - commits.length;
  if (leftOut > 0) {
    context.logger.log(`Leaving out ${leftOut} commits from before the first release.`);
  }
  return { ...context, commits };
}
