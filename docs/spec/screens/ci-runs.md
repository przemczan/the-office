# CI tab

Covers: the CI tab of Work, the list of recent CI runs, Refresh, per-Project problems, the GitHub App permissions prompt, re-running a failed or cancelled run, Start a workflow.

## Where it is

- Route: `/work/ci`, the fifth tab of the Work page ([work-board.md](work-board.md)); its label is **CI**, with no count.
- It lists each Project's recent CI runs, in the Projects the Project filter shows ([shell.md](shell.md)).

## Layout

- The GitHub App permissions prompt, only when permissions are missing ([pull-requests.md](pull-requests.md#github-app-permissions-prompt)).
- The head: a hint line, **Refresh** and **Start a workflow**.
- The alerts: a refused refresh, a warning per Project with a problem, a danger alert when the list can't be read.
- The note of CI runs in other Projects.
- The table.

## Head

- Hint: "Read from the code host every minute, and on Refresh."
- **Refresh** (refresh icon) asks the service to read now; `ci-runs.changed` brings what it found. A refusal shows as the alert "The CI runs weren't refreshed".
- **Start a workflow** (play icon, primary) opens the window below.

## Problems

- A warning per shown Project that couldn't be read, titled "<Project>'s CI runs weren't refreshed".
- Its words are the code host's own when it refused to be read, or "<code host> couldn't be reached at 14:02."

## Table

- Columns, in order: **Status**, **Run**, **Project**, **Branch**, **Commit**, **Trigger**, **Started**, and an unlabelled actions column.
- **Status**, a badge with its meaning on hover:
  - **Queued** (neutral): "It is waiting for a runner to pick it up."
  - **Waiting** (warning): "It is waiting, such as for an approval or another run."
  - **Running** (info): "It is running now."
  - **Succeeded** (success): "Every job passed."
  - **Failed** (danger): "At least one job failed."
  - **Cancelled** (neutral): "It was cancelled before it ended."
  - **Skipped** (neutral): "It was skipped and didn't run."
  - **Unknown** (neutral): "The code host's status isn't one The Office knows."
- The warning badge **Out of date** sits beside the status of every run of a Project whose last refresh failed; hover "The last refresh couldn't read this Project's CI runs, so what it shows may be out of date."
- **Run**: "<workflow> #<number> · <title>" as a link to the code host, opening in a new tab; "attempt <n>" beside it from the second attempt.
- **Project**: the Project chip.
- **Branch**: the branch in a monospace font ("—" when none), and a **Task** link to the Task page when The Office's Task made the run ([task-page.md](task-page.md)).
- **Commit**: the first 7 characters of the commit, monospace.
- **Trigger**: the code host's trigger word.
- **Started**: "18 min ago", "<1 min ago" within the day, "9 Nov, 10:05" before, or "Not started yet".
- Actions: on a **Failed** or **Cancelled** run only, a More menu (label "More for <run>") with **Re-run all jobs** and **Re-run failed jobs**. While it runs again the button shows a loader and "Re-running…" shows beside it; a refusal shows beside it as an alert line. Any other status has no actions.
- The note "<n> more CI runs in other Projects" with **Show all projects** counts the runs the Project filter hides.

## Start a workflow window

- Title **Start a workflow**; size medium, keeps its height as its fields come and go.
- Text: "Starts a GitHub Actions workflow whose file declares workflow_dispatch, on a branch or tag."
- **Project** (select, placeholder "Choose a Project"): hidden when the Project filter shows exactly one Project (that Project is used); otherwise it offers the Projects the CI tab lists, with the only one chosen when just one is listed. With none: "No Project lists CI runs yet. A Project whose repository is on GitHub shows here."
- **Branch or tag** (searchable select; hint "The workflow runs on this ref, with its file as it is there."; placeholder "Find a branch or tag"; clear button "Clear the branch or tag"; "No branch or tag matches"): the branches first, then the tags as "v1.2.0 (tag)". It starts on the Project's base branch; clearing it leaves it empty. A read problem shows as a warning, an error as a danger alert.
- **Workflow** (select, placeholder "Choose a workflow"): the workflows on that ref whose file declares a start by hand. States: "Reading the workflows…", the read's problem as a warning (said once when the ref list gave the same one), or "No workflow on <ref> can be started by hand. A workflow can once its file there declares workflow_dispatch."
- One control per input the chosen workflow declares there: a text field for text and environment inputs, a number field, a switch for yes or no (hint as description), a select ("Choose one") for a choice. An input's description is its hint; a required input is marked required; each starts at its default (a yes or no at off).
- Changing the Project clears the ref and the workflow; changing the ref clears the workflow; changing the workflow clears the entered values.
- Button **Start**, disabled with its reason on hover: "Choose a branch or tag first.", "Choose a workflow first." or "Give <inputs> a value first."
- A refusal shows as the alert "The workflow wasn't started".
- Done: toast "<workflow> started on <ref>. Its run shows here once GitHub queues it.", the window closes and the runs are read again.

## States

- Loading: a row loader, "Loading CI runs…".
- Error: a danger alert with the list's error message.
- Empty: "No CI runs yet. A Project whose code host runs a workflow on a push or a pull request shows its runs here."
- Narrow window: the table wraps its wrapping columns (Run, Branch).

## Domain facts

- [Projects](../2.1.1-projects.md).
- [Gates and checks](../2.3.3-gates-and-checks.md), [Publish](../2.3.4-publish.md).
