// Lints a commit message against the repository's commitlint.config.js.
import lint from "@commitlint/lint";
import load from "@commitlint/load";
import { subjectOf, type Commit } from "./commits-to-check.ts";

/** The reasons a message isn't a Conventional Commit; none when it is one. */
export type MessageLinter = (message: string) => Promise<string[]>;

export interface CommitFailure {
  commit: Commit;
  problems: readonly string[];
}

type LintOptions = NonNullable<Parameters<typeof lint>[2]>;

export async function loadMessageLinter(repositoryRoot: string): Promise<MessageLinter> {
  const config = await load({}, { cwd: repositoryRoot });
  const options: LintOptions = {
    parserOpts: config.parserPreset?.parserOpts as LintOptions["parserOpts"],
    plugins: config.plugins,
    ignores: config.ignores,
    defaultIgnores: config.defaultIgnores,
    helpUrl: config.helpUrl,
  };
  return async (message) => {
    const outcome = await lint(message, config.rules, options);
    return outcome.errors.map((error) => `${error.message} [${error.name}]`);
  };
}

export async function failingCommits(
  commits: readonly Commit[],
  lintMessage: MessageLinter,
): Promise<CommitFailure[]> {
  const failures: CommitFailure[] = [];
  for (const commit of commits) {
    const problems = await lintMessage(commit.message);
    if (problems.length > 0) failures.push({ commit, problems });
  }
  return failures;
}

export function failureReport({ commit, problems }: CommitFailure): string {
  const lines = [`${commit.sha.slice(0, 7)} ${subjectOf(commit.message)}`];
  for (const problem of problems) lines.push(`  ✖ ${problem}`);
  return lines.join("\n");
}
