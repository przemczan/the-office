// Checks that commits reaching main are Conventional Commits (AGENTS.md, "Commits and releases").
//   --from <sha> --to <sha>   a push's commits after the newest release
//   --message-file <path>     one message, such as a pull request's title and body
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { commitsToCheck } from "./commits-to-check.ts";
import { failingCommits, failureReport, loadMessageLinter } from "./conventional-commit.ts";
import { commitsBetween, newestRelease } from "./repository.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
// npm runs a workspace's script in the workspace's folder; a path given on the command line is the caller's.
const callerFolder = process.env["INIT_CWD"] ?? process.cwd();

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    "message-file": { type: "string" },
  },
});

const lintMessage = await loadMessageLinter(repositoryRoot);
const messageFile = values["message-file"];

if (messageFile !== undefined) {
  const problems = await lintMessage(readFileSync(resolve(callerFolder, messageFile), "utf8"));
  if (problems.length > 0) {
    console.error("The message isn't a Conventional Commit:");
    for (const problem of problems) console.error(`  ✖ ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("The message is a Conventional Commit.");
  }
} else if (values.from !== undefined && values.to !== undefined) {
  const range = commitsBetween(repositoryRoot, values.from, values.to);
  const toCheck = commitsToCheck(range, newestRelease(repositoryRoot, values.to));
  if ("reason" in toCheck) {
    console.log(`Nothing checked: ${toCheck.reason}.`);
  } else {
    const failures = await failingCommits(toCheck.commits, lintMessage);
    if (failures.length > 0) {
      console.error(
        `${failures.length} commit(s) after ${toCheck.after} aren't Conventional Commits:`,
      );
      for (const failure of failures) console.error(failureReport(failure));
      process.exitCode = 1;
    } else {
      console.log(
        `${toCheck.commits.length} commit(s) after ${toCheck.after} checked, all Conventional Commits.`,
      );
    }
  }
} else {
  console.error("Usage: check-commits --from <sha> --to <sha> | --message-file <path>");
  process.exitCode = 2;
}
