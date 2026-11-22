# Pull requests tab

Covers: the Pull requests tab of Work, the list of open pull requests, Refresh, per-Project problems, the GitHub App permissions prompt, Checks and Mergeable, the Merge window, the Close window, Resolve conflicts, the pull request badge on a Task.

## Where it is

- Route: `/work/pull-requests`, the fourth tab of the Work page ([work-board.md](work-board.md)).
- The tab shows a count of the open pull requests while it is above 0 ([work-board.md](work-board.md#tabs)).
- It lists the open pull requests The Office opened, in the Projects the Project filter shows ([shell.md](shell.md)).

## Layout

- The GitHub App permissions prompt, only when permissions are missing.
- The head: a hint line and **Refresh**.
- The alerts: a refused refresh, a warning per Project with a problem, the outcome of Resolve conflicts, a danger alert when the list can't be read.
- The note of pull requests in other Projects.
- The table, with the Merge and Close windows over it.

## Head

- Hint: "Read from GitHub every minute, and on Refresh. Merged and closed ones leave the list."
- **Refresh** (refresh icon) asks the service to read now; `pull-requests.changed` brings what it found, so the list changes by itself.
- A refused refresh shows the alert "The pull requests weren't refreshed" with the service's reason.

## GitHub App permissions prompt

- A warning, "The GitHub App needs more permissions", while the GitHub App lacks permissions The Office needs ([2.3.4](../2.3.4-publish.md)); nothing while every installation has them or while signed out.
- Body: "Without them The Office can't read every pull request's checks or merge state, or import, comment on and close issues. Missing:", the permissions as GitHub's settings name them with their level ("Checks (read)", "Pull requests (write)", "Commit statuses (read)", "Issues (write)"), the link "Add them to the App on GitHub", and "Accept on each installation:" with a link per installation.
- **Check again** reads the permissions again; a refusal shows as "The permissions weren't checked".
- The CI tab shows the same prompt ([ci-runs.md](ci-runs.md)); Settings › Office identity does too ([settings.md](settings.md)), and, only while the Issues permission is missing, a Project's GitHub issues card and the Import issues window ([project-page.md](project-page.md#github-issues)).

## Problems

- A warning per shown Project that couldn't be read, titled "<Project>'s pull requests weren't refreshed".
- Its words are the code host's own when it refused to be read, or "<code host> couldn't be reached at 14:02; showing what it said at 13:58." (the second part only when something was read before).

## Table

- Columns, in order: **Pull request**, **Task**, **Project**, **Branch**, **Checks**, **Mergeable**, **Checked**, and an unlabelled actions column at the right.
- **Pull request**: "#42 <title>" as a link to the code host, opening in a new tab (external-link icon).
- **Task**: the Task's title linking to its page ([task-page.md](task-page.md)); "Task not found" when it isn't among the Tasks; empty until the Tasks are read.
- **Project**: the Project chip.
- **Branch**: "<branch> → <base branch>", in a monospace font.
- **Checks**, a badge with its meaning on hover:
  - **Passing** (success): "Every check passed."
  - **Failing** (danger): "At least one check failed."
  - **Running** (warning): "Checks are still running."
  - **No checks** (neutral): "No check runs on this pull request."
  - **Can't read** (neutral): "GitHub didn't let The Office read the checks. The App may lack a permission."
- **Mergeable**, a badge likewise:
  - **Can merge** (success): "It merges into its base cleanly."
  - **Conflicts** (danger): "It conflicts with its base; the conflicts are resolved before it can merge."
  - **Checking…** (neutral): "GitHub hasn't worked out yet whether it merges."
- **Checked**: when its status was last read: "18 min ago" or "<1 min ago" within the day, "9 Nov, 10:05" before, "Not checked yet". The warning badge **Out of date** (hover "The last refresh couldn't read this pull request, so what it shows may be out of date.") shows when the last refresh couldn't read it.
- Actions column, left to right: Resolve conflicts or the open Conflict resolution Task, **Merge…** (secondary), **Close…** (ghost).
- One merged or closed leaves the list.
- The note "<n> more pull requests in other Projects" with **Show all projects** counts those the Project filter hides.

## Resolve conflicts

- **Resolve conflicts** shows on a row whose Mergeable is Conflicts and that has no open Conflict resolution Task. Hover: "Make a Conflict resolution Task, which merges the base branch into this pull request's branch and resolves the conflicts, then start it."
- While the row's Task has an open Conflict resolution Task (neither Done nor Dropped), the row shows "Resolving:" and that Task's link with its state instead.
- Pressing it makes the Conflict resolution Task and starts it ([2.3.4](../2.3.4-publish.md)).
- Its outcome shows above the table until closed:
  - refused: the danger alert "No Conflict resolution Task was made for #42 <title>" with the reasons and **Dismiss**;
  - made but not started: the warning "The Conflict resolution Task was made but didn't start", the reasons, then "<Task> (state). It stays Ready; start it from its page once nothing holds it.";
  - queued: an info alert "<title> is queued, place <n>: <reasons>".
- The Task shows at once from the answer, before the Tasks are read again.

## Merge window

- Title "Merge #42 <title>"; size medium; closing after choosing a method asks first.
- Text: "<branch> goes into <base branch>."
- A line "Checks <badge> Mergeable <badge>", as in the table.
- A warning when checks fail or it conflicts: "Checks are failing and it has conflicts", "Checks are failing" or "It has conflicts with its base", with "The merge can still be tried; GitHub refuses it when the base branch's rules don't allow it." Failing checks and conflicts are a caution, not a block.
- **Merge method**, a radio of the methods the repository allows, the recommended one picked at first, in GitHub's words: "Create a merge commit", "Squash and merge", "Rebase and merge". A skeleton shows while they are read; the alert "The merge methods can't be read" shows a failure.
- A warning with the service's words when it has one.
- A line on the branch: with the Project's Delete branches once merged On, "The Office deletes the branch once it is merged."; Off, "GitHub deletes the branch once it is merged.", "The branch stays after the merge.", or "The Office doesn't delete the branch; GitHub deletes it only if the repository is set to."
- Button **Merge pull request**, disabled until a method is known.
- A refusal shows as the alert "The pull request wasn't merged" with the code host's words; when the pull request changed since The Office read it, the alert carries **Refresh**, which reads it again so the merge can be tried once more.
- Done: toast "#42 merged." and the window closes.

## Close window

- Title "Close #42"; size small.
- Text: "Close #42 without merging? The branch stays, and it can be reopened on GitHub."
- Button **Close pull request** (danger).
- A refusal shows as the alert "The pull request wasn't closed" (with **Refresh** as above).
- Done: toast "#42 closed." and the window closes.
- While a window is open it shows the pull request as last read, or as it was opened on once it has left the list.

## Pull request on the Task page

- The Task's head shows **Open pull request** (external-link icon), a link to the pull request in a new tab, once Publish opened one ([task-page.md](task-page.md)).
- Once the pull request was merged or closed, a badge beside it says **Pull request merged** (success) or **Pull request closed** (neutral). Hover: "#12 merged (squash) by Ann Lee, 19 Nov, 14:02", "#12 closed on GitHub, 19 Nov, 14:02" (the method as "merge commit", "squash" or "rebase"; "by you" for the signed-in user).

## States

- Loading: a row loader, "Loading pull requests…".
- Error: a danger alert with the list's error message.
- Empty: "No open pull requests. A Task whose Project publishes by pushing and opening a pull request opens one at Publish; it shows here until it is merged or closed."
- Narrow window: the table wraps its wrapping columns (Pull request, Task, Branch).

## Domain facts

- [Publish](../2.3.4-publish.md).
- [Tasks](../2.1.3-tasks.md#task-states).
- [Projects](../2.1.1-projects.md).
