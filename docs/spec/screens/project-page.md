# Project page

Covers: a Project's page and its head, the section tabs, Overview (the dashboard: the Actions tile, Onboarding, Onboard and Onboard again, following an Off-board Task, Work, the Project limit, the tiles for Initiatives, Ideas, CI, Pull requests, Test instances, Environment, Remote sign-in and Recent activity), Files, Commands (install, install inputs, commands, Publish, Delete branches once merged), Environment (variables, Secret variables, environment check), Pipelines (Default Pipeline and its rows by Kind, Project Pipelines), GitHub issues (the Import issues window, auto-import, write-back), Run environment (Set up run environment), Devices (the Project's devices, Add a device, pairing, Change Port, Pair again, Remove), Test targets (the list, the editor, Install on a device, asking for them in a chat, the open Proposal), Test instances (Launch on a branch, instances by branch), the Branch picker, Actions (the list, the editor, the open Proposal, the Run window and its confirm step, an Action's History, a run's log), Engine, Skills, Server values, Features (the switches, the tabs a switched-off feature hides), Appearance (Mark, Icon and Logo, How it looks).

## Where it is

- Route: `/projects/$projectId`, a parent with one child route per section, under the Projects page's `/projects`.
- It opens in the pane beside the Projects list ([projects.md](projects.md#layout)), from its item there or from any link to a Project.
- The page title is the Project's name; its crumb is the name, with "Projects" as its parent (back to `/projects`).
- Sections and their routes, in the tabs' order:
  - **Overview**: `/projects/$projectId` (no redirect; a redirect would drop a link's `?chat=…&thread=…`).
  - **Files**: `/projects/$projectId/files?branch=&path=`.
  - **Commands**: `/projects/$projectId/commands`.
  - **Environment**: `/projects/$projectId/environment`.
  - **Pipelines**: `/projects/$projectId/pipelines`, and an open Project Pipeline at `/projects/$projectId/pipelines/$projectPipelineId`.
  - **GitHub issues**: `/projects/$projectId/issues`.
  - **Run environment**: `/projects/$projectId/run-environment`.
  - **Devices**: `/projects/$projectId/devices`.
  - **Test targets**: `/projects/$projectId/test-targets`, with Test instances in the same section.
  - **Actions**: `/projects/$projectId/actions`, an open Action's History at `/projects/$projectId/actions/$actionKey`, and a run's log opened over it with `?run=<id>`; its tab hidden while the Project's `actions` feature switch is off ([Actions](#actions)).
  - **Engine**: `/projects/$projectId/engine`.
  - **Skills**: `/projects/$projectId/skills`.
  - **Server values**: `/projects/$projectId/server-values`.
  - **Features**: `/projects/$projectId/features`.
  - **Appearance**: `/projects/$projectId/appearance`.
- A switched-off feature's tab (GitHub issues, Run environment, Devices, Test targets, Actions) is gone from the tabs; its address shows a note ([Features](#features)).
- An unknown Project says so at every section's address ([States](#states)).

## Layout

- The page fills the pane beside the Projects list.
- The head, at the top.
- Below it a row of tabs, one per section, labelled as in [Where it is](#where-it-is); choosing one opens its address.
- A section's tab stays chosen on its sub-addresses, such as an open Project Pipeline.
- On a narrow pane the tabs scroll sideways.
- Below the tabs the open section: its blocks are cards stacked in one column, 1100px at most wide; the Overview takes the pane's whole width ([Overview](#overview)).
- The section breakpoints below are measured on the pane's width, not the page's.
- At a page width of 1224px and under the page shows alone, with **‹ All Projects** above it back to the list ([projects.md](projects.md#states)).
- At a page width of 664px and under, the page padding shrinks to 14px.
- At a pane width of 664px and under, two-column rows stack.

## Head

- The Project's Logo (page size), its name, then a meta line: the onboarding badge (**Onboarding** or **Onboarded**, read from the Project's latest Onboard Task, when it has one), the Project's folder path (monospace) and "· <base branch>".
- When the Project was cloned: a line "Repository URL" with the URL.
- The remote's needs line: which part of the Office identity the base branch's remote needs, and what is missing. It shows only while the Project has a remote, and changes when `github.changed` arrives.
  - GitHub over https: "Its remote is GitHub over https, reached with Sign in with GitHub."; missing: "Not signed in with GitHub."; with a link to **Settings › Office identity**.
  - ssh: "Its remote, <host>, is reached over ssh with the Office ssh key, whose public half the host needs."; missing: "The Office ssh key isn't made yet." and/or "<host>'s host key isn't confirmed yet: it becomes a Trusted host once its fingerprint is confirmed."; with the link to Settings › Office identity.
  - Anonymous https: "Its remote, <host>, is reached anonymously over https, so only a public repository can be fetched."
  - A local folder: "Its remote is a folder on this workstation, which needs nothing of the Office identity."
  - Refused scheme: "Its remote is reached by <scheme>, which The Office refuses: it reaches remotes over https and ssh only."
- The Logo is the Project's Logo, else its Icon, else its mark.

## Overview

- The Project's dashboard: how it stands, each tile linking to where its details live.
- Top to bottom:
  - the Actions tile, first, while the Project's `actions` feature switch is on; until Actions are built ([2.15](../2.15-actions.md)) this place shows nothing;
  - Onboarding;
  - Work;
  - a grid of tiles: Initiatives, Ideas, CI, Pull requests, Test instances, Environment, Remote sign-in, Recent activity.
- The grid's columns are at least 300px wide, as many as fit the pane; at a pane width under 640px it is one column.
- Initiatives and Recent activity span two columns while the pane fits two.
- Each tile is a card with its icon and title, and its link at the title's end.
- While a tile's reads load it shows a skeleton; a failed read shows its error in that tile only, the others as they are.
- A tile tied to a feature switch is gone while the switch is off; `project.features-changed` shows or hides it.
- Each tile refreshes from the events already named below; the Overview adds no read or event of its own.

### Onboarding

- Card **Onboarding** (hard-drive icon) with the onboarding badge at its end, then **Onboard** (primary, play icon) while the Project never had an Onboard Task, or **Onboard again** (secondary, rotate icon) once its latest is Done or Dropped; neither while one is in flight ([2.1.1](../2.1.1-projects.md#onboarding-a-project)).
- With none yet: "Not onboarded yet. Devops makes it build and test in a fresh worktree, asking before installing anything, then publishes the fixes." and the note "Starts at once as an Off-board Task: no Start, not on the board. It waits Queued while the Project limit or the queue is full."
- With one: the latest Onboard Task as [Following an Off-board Task](#following-an-off-board-task) shows it.
  - Done adds "Onboard again starts a new Onboard Task on the base branch as it is now, for when the toolchain or the commands have changed."; Dropped adds "Not onboarded. Onboard again starts a new Onboard Task."
- With earlier ones: "Onboarding history: <title> · Done 2 Oct · <title> · Dropped 28 Sep", each a link to its Task.
- Onboard toasts "<Person> is onboarding <Project>.", "<title> is queued, place N: <reasons>." or "<title> is already under way."; a refusal shows under the button as **Onboard didn't start** with the reasons.
- It refreshes with any Task event.

### Following an Off-board Task

- The Onboarding and Run environment cards show their Off-board Task the same way ([2.1.3](../2.1.3-tasks.md#off-board-tasks)): a state badge and the Task's title, its Stages as a rail (not once Done or Dropped), a meta line, and at the head's end **Open the Thread** while a Stage runs with a Thread, else **Open the Task**.
- **Queued**: "Place N in the queue", the short reasons and "Queued for <time>", with "It starts by itself once there is room. Move it up on Now's Queue."
- **Running**: the person's avatar and name, "<time> in Stage" and its tokens.
- **Waiting on you**: "<Person> asks: <question>", **Answer** (the Task page at the Decision), "Asked <time> ago" and its tokens.
- **Paused**: "Paused at <time>", its tokens and **Resume**.
- **Failed**: "<Stage> failed, and its rounds are used up."
  - While the holder of Asked first when a Stage runs out of tries has it: "Asked <Person> (<title>) first. It comes to you, here and in Needs you, if <Person> passes it on.", with no Retry.
  - Once it is the user's: a danger alert with the error, **Retry**, **Open the Decision** and "Retry runs <Stage> again, with the failure in its Brief."; a refusal shows **Nothing was retried**.
- **Done**: "Done on <day>" and its tokens; **Dropped**: "Dropped on <day>", the Drop reason and its tokens.
- **Ready**, for one made before: "Made before Off-board Tasks started at once, so it waits for your Start." with **Start**.

### Work

- Card **Work** (kanban icon) with two links at its end:
  - **Open in Work**: goes to `/work`.
  - **CI runs**: narrows the Project filter to this Project, then goes to `/work/ci`.
- Four tiles with a count of the Project's Tasks each:
  - **Running**: Tasks In progress or Paused.
  - **Waiting on you**: the Tasks waiting on the user ([work-board.md](work-board.md)).
  - **Ready to start**: Tasks in Ready.
  - **Not planned yet**: Tasks in Backlog or Planning.
- Note under the tiles: "Off-board Tasks aren't counted here: the Onboarding and Run environment cards show them. They still take a running slot under “Running Tasks at once in this Project”."
- **Running Tasks at once in this Project**: a stepper, 1 to the Project limit's maximum (`PROJECT_LIMIT_MAX`), saved at each step.
- Note: "Lowering it lets running Tasks finish; nothing new starts in this Project until one ends."
- A refusal shows under the stepper.

### Initiatives tile

- Card **Initiatives** (flag icon) with the link **All Initiatives** at its end: it narrows the Project filter to this Project, then goes to `/work/initiatives`.
- The Initiatives spanning the Project that are Shaping or Active and not archived, the Active first.
- One row each:
  - its name, linking to its Initiative page ([initiative-page.md](initiative-page.md));
  - **Shaping** while it is Shaping, **Paused** while it is paused;
  - a progress bar with "<n> of <m> Tasks done", as on [the Initiatives tab](initiatives-tab.md), once it has Tasks.
- Empty: "No Initiative spans <Project> right now."
- It follows `initiative.*` and `task.*`.

### Ideas tile

- Card **Ideas** (lightbulb icon) with the link **Open Ideas** at its end: it narrows the Project filter to this Project, then goes to `/work/ideas`.
- "<n> New Ideas": the Project's Ideas in New.
- The newest 3 by when they were captured, each its title linking to it on Work › Ideas (`?idea=<id>`), with its age.
- Empty: "No new Ideas for <Project>."
- It follows `idea.*`.

### CI tile

- Card **CI** (activity icon) with the link **CI runs** at its end: it narrows the Project filter to this Project, then goes to `/work/ci`.
- The newest run on the base branch: its status badge in Work › CI's words, "<workflow> #<n> · <title>" linking to its logs on the code host, then its branch, short commit and age.
- Under it the newest run on any branch, when that is a newer one.
- "Out of date" while the listing is stale.
- The listing's problem, in Work › CI's words, as an error line.
- Empty: "No CI runs on GitHub yet."
- With no listing for the Project, as its code host isn't GitHub: "CI runs need a code host The Office reads."
- It follows `ci-runs.changed`.

### Pull requests tile

- Card **Pull requests** (git-pull-request icon) with the link **Pull requests** at its end: it narrows the Project filter to this Project, then goes to `/work/pull-requests`.
- "<n> open": the Project's open pull requests.
- The newest 3, each "#<n> <title>" linking to it on the code host, its **Checks** and **Mergeable** badges in Work › Pull requests' words, and **Its Task**, linking to the Task that opened it.
- Each of the Project's problems, in Work › Pull requests' words, as an error line.
- Empty: "No open pull requests."
- It follows `pull-requests.changed`.

### Test instances tile

- Card **Test instances** (flask-conical icon) with the link **Test targets** at its end, to `/projects/$projectId/test-targets`.
- The Project's Building and Running instances on every branch, the newest launched first.
- One row each: the target's name, its state badge, the branch, and the Initiative it is linked to, linking to its page.
- A Running Hosted instance has **Open**, as on [Test instances](#test-instances).
- Empty: "None running."
- Gone while the `test-targets` feature switch is off.
- It follows `test-instance.changed`.

### Environment tile

- Card **Environment** (shield-check icon) with the link **Environment** at its end, to `/projects/$projectId/environment`.
- The last environment check's badge, as the [Environment check](#environment-check) block's, and when it ended, or started while it runs.
- A Failed check adds "Failed at: <step>", its first failed step by name.
- Empty: "Not checked yet."
- It follows `project.environment-check-changed`.

### Remote sign-in tile

- Card **Remote sign-in** (key-round icon) with the link **Settings › Office identity** at its end.
- The remote's needs in the head's words ([Head](#head)).
- With nothing missing and the code host reading: **Signed in** (success).
- With something missing, or the code host refusing to be read as the CI or pull request listing last found it: **Needs attention** (warning), then each, the missing parts in the head's words and the refusal in the code host's.
- A remote that needs nothing of the Office identity (a local folder, anonymous https, a refused scheme): its words alone, without a badge.
- Without a remote branch: "Its base branch tracks no remote branch, so it needs nothing of the Office identity."
- It follows `github.changed`, `ci-runs.changed` and `pull-requests.changed`.

### Recent activity tile

- Card **Recent activity** (history icon) with the link **Open in Work** at its end, to `/work`.
- A timeline of the Project's last 7 days, newest first, 10 lines at most ([2.1.1 Recent activity](../2.1.1-projects.md#recent-activity)), each with its age:
  - "Done: <Task>", with " · published" when its commit message was published too;
  - "Published: <Task>", for a Task published but not Done;
  - "Idea captured: <title>".
- Each names its record with a link: the Task's page, or the Idea on Work › Ideas.
- A Done Task archived since leaves it, as the Task list holds no archived Task.
- Empty: "Nothing in the last 7 days."
- It follows `task.*` and `idea.*`.

### Actions tile

- Card **Actions** (play icon) with the link **All Actions** at its end, to the [Actions](#actions) section.
- Up to 5 of the Project's Actions, in the Actions section's order, one line each: its name, the **Leaves the workstation** badge when it has it, its last run's state badge ([Actions](#actions)), and **Run**, which opens [the Run window](#the-run-window), disabled while its last run is running, as on [the Actions list](#the-actions-list).
- With more than 5: "<n> more under Actions", linked.
- With none: "No Actions yet: things to run on demand, such as an install on a phone or a release." with a link "Add one under Actions".
- It follows `action-run.changed`.
- Gone while the `actions` feature switch is off.
- Rules: [2.15](../2.15-actions.md#who-starts-an-action).

## Files

- Route `/projects/$projectId/files?branch=&path=`; the address holds the branch and the selected path, so a link reopens the same file. An empty `branch` or `path` isn't in the address.
- The section fetches the base branch's remote as it opens ("Fetching branches…" meanwhile); a read error shows **The branches can't be read**.
- **Branch** picker (a grouped select, placeholder "Choose a branch"):
  - **Base branch** first, with the badge "base branch".
  - **Local branches**, then **Remote branches**.
  - No `branch` in the address means the base branch; picking the base branch removes `branch` from the address. Picking changes the address by replacing the entry.
- A fetch failure shows the warning **Showing the last commits known on this workstation**: "The branches couldn't be fetched, so newer commits may be missing: <problem>".
- A `branch` the Project doesn't have shows the warning "<name> has no branch <branch>" with "It may have been deleted, or not be known on this workstation." and a link **Show <base branch>**.
- Beside each other: the file tree (named "Files on <branch>", the selected path revealed and selected) and the **Preview** section.
  - At a pane width of 900px and under they stack.
  - The tree and preview are keyed by the branch, so switching a branch keeps no path or open folder.
  - Selecting a path sets `path` in the address, replacing the entry.
- What the path names is told by its folder's entries:
  - No path: "No file selected", "Select a file in the tree to see it here."
  - A folder: "<path> is a folder", "Select a file in it to see it here."
  - Nothing there: "No file or folder <path> on <branch>", "Select a file in the tree to see it here."
  - Reading: "Reading the folder…" or "Reading the file…"; errors **This file can't be read**.
- The file's head: its name (the path as its tooltip) and the actions **Download**, **Copy path** (toast "Path copied.") and **Copy link** (the address for the branch and path; toast "Link copied.").
- The preview by the file's kind:
  - Text: with line numbers.
  - A Markdown file (`.md`, `.markdown`): opens **Rendered**, with a switch to **Source**.
  - An image: shown.
  - Binary, or over 1 MB (`FILE_PREVIEW_BYTES`): "This file can't be previewed", with why ("It holds binary data (<size>). Download it to open it." or "It is <size>, over the <limit> a preview shows. Download it to read it.") and **Download**.

## Commands

- One card **Commands** (terminal icon) with **Ask <name> to propose a change** (Ask Devops, draft "Can you propose a change to the commands of <Project>? ") at its end.
- Rows, each a name, its line in monospace, and a pencil that edits it in place (**Save** and **Cancel**; Enter saves, Escape cancels; a refusal shows under the row as the service words it):
  - **Install**: the install command; blank shows "Not set". Toast "Install command saved. Tasks install with it before their next Stage."
  - **Install inputs**: placeholder `package-lock.json, apps/web/package.json`; blank shows "None: a worktree installs once." Toast "Install inputs saved."
  - One row per command, in the Project's order: its name, its line ("Not set" while blank) with a test command's re-run command under it ("Re-run <line>", monospace) when set, badges for its key (monospace) and kind (**Build**, **Lint** or **Test**), a pencil ("Change the <name> command") and a trash ("Remove the <name> command").
- Editing a command: **Name**, **Kind** (hint "A test command's runs never reach the work.") and **Command line**; the key is shown as a badge and never edited.
- While the kind is **Test**, the form also has **Re-run command** (placeholder `npm run test:e2e -- --last-failed`, hint "Runs once in place of the command when it fails, to tell a flake: run only what failed. Leave blank for no re-run. Files the first run wrote that git ignores are still there."); choosing another kind clears it ([2.1.1](../2.1.1-projects.md#the-re-run-command)). Toast "<name> saved. Tasks run it as saved from their next Stage that runs it."
- **Add a command** opens an inline form with **Key** (hint "Lower-case letters, digits and "-"; fixed once added.", placeholder `test-e2e`), **Name** (placeholder "End-to-end tests"), **Kind**, **Command line** (placeholder `npm run test:e2e`) and, for a test command, **Re-run command**, with **Add**; refusal **The command wasn't added**; toast "<name> added."
- A refusal of a change shows **The command wasn't saved**.
- **Remove** asks in a small window "Remove <name>?": "The command <key> is removed from <Project>. A Stage that runs it can't run it any more." with the button **Remove** (danger); refusal **Nothing was removed**; toast "<name> removed."
- The service refuses clearing an install command or a command once set; a command added later can't be blank.
- Note under the rows: "Script Stages run these in the Task's worktree with no Agent, as they are when the Stage runs. A test command's runs never reach the work."
- The **Publish** group (heading "Publish"):
  - **Publishing**: a select saved at once, "Push and open a pull request" or "Merge into <base branch>"; toast "Publishing saved. Tasks in <name> <mode in lower case>."
  - **Before publishing**: placeholder `npm run changelog`; blank shows "None"; saving blank clears it; hint "Runs in the Task's worktree before anything leaves; what it changes is committed and published."; toasts "Before publishing line saved." / "Before publishing line cleared."
  - **After publishing**: placeholder `./scripts/notify.sh`; blank shows "None"; hint "Runs in the Task's worktree once the pull request opens or the merge lands, with OFFICE_PUBLISHED_BRANCH, OFFICE_PUBLISHED_COMMIT, OFFICE_PULL_REQUEST_URL when there is one, and OFFICE_PUBLISHING_MODE."; toasts "After publishing line saved." / "After publishing line cleared."
  - **Delete branches once merged**: a switch saved at once, Off by default; hint "Deletes a Task's branch here and on the remote once it is merged, and an Initiative's once it is Done and published. A branch holding work the base lacks is never deleted."; toasts "Branches of <Project> are deleted once merged." / "Branches of <Project> are kept after merge." ([5.5](../5.5-git-and-isolation.md#delete-branches-once-merged)).
  - Note: "Publish runs both lines with the Project's own variables, never The Office's credentials: keep a token in a Secret variable. Each runs again every time Publish runs, so it must be safe to run twice, and the Script Stage time limit of 30 minutes applies."
- Only one row is edited at a time.

## Environment

- Two cards: **Environment variables**, then **Environment check**.

### Environment variables

- Note: "Every command and Agent of the Project runs with these once saved."
- A form named "Environment variables"; a draft kept until **Save**, sent as a whole (`PUT /projects/:id/environment`):
  - **Variables to set**: one `NAME=value` per line, hint "One NAME=value per line, such as JAVA_HOME=/opt/java-21."
  - **Secret variables**: a group with **Add a Secret variable**. Each row has **Name**, **Value** (never shown again once saved; a kept value shows as set) and a remove button ("Remove the Secret variable <name>"). With none: "None yet. Add one for a token a command needs, such as NPM_TOKEN; its value is never shown again once saved." With some: "A value is never shown again once saved, and shows as [secret NAME] in output. It takes one line of at least 6 characters."
  - **Variables to remove**: comma separated names, hint "Names The Office would pass on from its own environment, separated by commas."
  - **Folders in front of PATH**: one full path per line, hint "Full paths, one per line, searched in this order before the inherited PATH."
- **Save** is disabled until something changed (tooltip "Change a variable to save."); **Discard** shows while there is a draft.
- Problems found before sending, and the service's reasons, show as a list under the fields.
- The editor starts again from the saved environment whenever it changes, here or elsewhere: a typed Secret value is cleared, a kept one shown as set, and an edit in progress is lost when another tab saves.

### Environment check

- Badge at the head's end: **Not checked**, **Checking** (info), **Ready** (success), **Failed** (danger), **Stopped** (warning); none while it loads.
- Note: "Tries the saved environment in a fresh worktree of <base branch>: install, then each of the Project's commands. It changes nothing."
- "Not checked yet." while there is no check.
- A list "Environment checks", each line with a state icon named **Waiting**, **Running**, **Passed**, **Failed** or **Skipped**:
  - The worktree line: "A fresh worktree of <remote branch>" (or "A worktree of <base branch>, which tracks no remote branch", or "A fresh worktree of <base branch>"), with "at <short commit>" or git's problem.
  - **Install** and each command by its name, with its line in monospace ("Not set" for a skipped one), a summary ("passed in 12 s", "failed with exit code 2", "failed after 3 s", "could not run: is its program installed and on PATH?", "ran out of time after 3 s", "stopped when The Office shut down") and, with output, **Show the output** / **Hide the output**; a failed line shows its output until hidden.
- **Run the environment check** (play icon; "Checking…" while it runs) starts it with no body; reasons of a refusal show under the list.

## Pipelines

- Route `/projects/$projectId/pipelines`, and `/projects/$projectId/pipelines/$projectPipelineId` for an open Project Pipeline.
- Layout: the lists on the left (the Default Pipeline card above the Project Pipelines list) and the detail on the right; at a pane width of 952px and under only the lists or the open one show, the detail with a back link "‹ <Project>'s Pipelines".
- While the Pipelines, Roles, duties or Role card options load the section shows nothing; a read error shows "<Project>'s Pipelines can't be read".

### Default Pipeline

- Card **Default Pipeline** (route icon): a row **Every Task**, "What <planner> proposes first, unless the Task's Kind has its own below.", with a Pipeline picker (hidden label "Default Pipeline"), saved at once, with the groups "<Project>'s Pipelines" then "Office-wide Pipelines"; each Pipeline shows its Stages line (a Project Pipeline adds "· built from <base>"), the current default first; a Broken Pipeline is listed with why and can't be chosen.
- Toast "<Project>'s default Pipeline is <name> now."
- A Broken default shows the danger alert "<name>, the default, is Broken": the reasons, then "New Tasks can't follow it, and <planner> proposes from the others, until it is fixed or another default is chosen."
- A sound default shows its line and "A new Task has no Pipeline until <planner> proposes one at planning, starting from this one, or you choose one." (<planner> is whoever holds Plans, or "whoever holds Plans" while nobody does).
- Under it, **By Kind**: a row each for **Features**, **Bugs** and **Chores** with its Kind's glyph, a Pipeline picker (hidden label "Default Pipeline for <Kind>s") whose first group, "Every Task's", holds **Same as every Task** with the default's name, then the same groups ([2.1.1](../2.1.1-projects.md#project-settings), "Default Pipeline per Kind").
- Each row saves at once; toasts "<Project>'s Bugs follow <name> now." or, for Same as every Task, "<Project>'s Bugs follow its default Pipeline again."; a refusal shows under the row.

### Project Pipelines list

- A list named "<Project>'s Pipelines" with a count; each row links to the Project Pipeline.
- Row: name, line "Built from <base> · N Stage changes" (or "· N Stage changes don't apply" while Broken), **Default** badge, **Broken** badge (danger), and the warning "Needs fixing" while its check has problems.
- Empty: "None yet: <Project>'s Tasks choose from the office-wide Pipelines. Add one to change a few Stages for <Project> alone."
- Foot: **Add a Pipeline built from…** (tooltip "A Pipeline of <Project>'s own, built from an office-wide one") and Ask Devops (**Ask <name>**, draft "Can you propose a Project Pipeline for <Project>? ").

### Add a Pipeline window

- A medium window "Add a Pipeline to <Project>", keeping one height.
- Text: "A Project Pipeline: only <Project>'s Tasks and its default can choose it."
- **Base Pipeline**: radios of the office-wide Pipelines (each with its Stages line), leaving out Onboard (its fixed id `onboard`); hint "The office-wide Pipeline it is built from. It starts as its Stages exactly; you then insert, replace, change or remove Stages, and <base>'s later edits still reach it."
- **Name**, filled with "<base> for <Project>" until typed; hint "Not a name an office-wide Pipeline or another of <Project>'s has."
- **Description** (placeholder "What it is for, in a sentence").
- **Add the Pipeline** adds it with no Stage change, shows "<name> added to <Project>'s Pipelines.", closes and opens it. **Ask <name> instead** (when someone holds the duty) opens their chat with the draft.
- Refusals: **The Pipeline wasn't added**, **The chat didn't open**.

### The open Project Pipeline

- Head card: its name with **Default** and **Broken** badges, **Ask <name>** (draft "Can you propose a change to <Project>'s <name> Pipeline? "), its description, and the facts line: "Project Pipeline of <Project> · Built from <base> · Default for <Project> · <use line>".
  - **Built from <base>** links to the base Pipeline in Settings › Pipelines (tooltip "Open <base> in Settings › Pipelines").
  - The use line counts the not started Tasks that use it.
- A Broken Pipeline shows the danger alert "<name> is Broken: N Stage changes no longer apply to <base>" with "Until it is fixed Tasks can't choose <name>. Tasks already started keep their Stages. Fix each one marked in red below, then save." After fixing (checked, before saving), the success alert "Fixed: save it, and Tasks can choose <name> again".
- Card with **Name**, **Base Pipeline** (hint "An office-wide Pipeline: its edits reach this one, and the Stage changes apply on top.") and **Description**, then the flow editor in its Project mode ([pipeline-flow-editor.md](pipeline-flow-editor.md#in-a-project-pipeline)).
- The service builds and checks every draft; Stages shown are the built ones until the check answers.
- The bar: "Unsaved changes" or "Saved"; **Remove** (danger ghost; opens the remove window of the Pipeline), **Discard**, **Save the Pipeline**.
  - Save is disabled while nothing changed, the Pipeline is Broken, a problem stands or the check is awaited; while Broken its tooltip is "Fix the Stage changes that don't apply first: a save never leaves it Broken".
  - Toast "Pipeline saved. Tasks not started yet follow it; running ones keep their copy."
  - A refusal shows as **The Pipeline wasn't saved**.
  - Remove toasts "<name> removed from <Project>'s Pipelines." and returns to the list.
- Each Project Pipeline starts its own draft.
- Nothing open: "Open one of <Project>'s Pipelines to see the Stages it gets and edit it."; an id the Project lacks: "<Project> has no such Pipeline: it may have been removed."
- With `?proposal=<id>` naming an open Proposal of the Pipeline's routes, the flow shows read-only under the Proposal's banner instead of the form ([pipeline-flow-editor.md](pipeline-flow-editor.md#proposal-on-the-flow)).

## GitHub issues

- Route `/projects/$projectId/issues`, the tab after Pipelines. Rules: [2.1.1](../2.1.1-projects.md#github-issues).
- Card **GitHub issues** (circle-dot icon) with **Import issues…** (secondary, github icon) in its head.
- When the repository isn't on GitHub, the card holds only an empty state with the service's words: "GitHub issues need a repository on GitHub. This Project's is at <host>."
- When the GitHub App lacks the Issues permission, the permissions prompt shows at the card's top ([pull-requests.md](pull-requests.md#github-app-permissions-prompt)).
- A row **Repository**: "<owner>/<repo> · <n> open issues not yet imported" ("Reading its open issues…" while read, "Its issues can't be read now." on a refusal), and at its right "Signed in with GitHub", or, signed out, "Sign in with GitHub in Settings › Office identity to import issues." with a link there; the switches can still be set.
- A refusal to read them shows as "The open issues can't be read".
- A row **Auto-import issues with a label**: "Open issues with this label become Tasks in Backlog. Checked every 5 minutes while The Office is signed in with GitHub.", a **Label** field (tag icon, up to 50 characters) and a switch.
  - Turning it on with no label says "Name the label first."; turning it off stores no label, and the field keeps the words while the page is open.
  - A change of the label while on saves as the field is left or on Enter.
  - Toasts: "Open issues labelled <label> become Tasks in <Project>." or "<Project> no longer imports issues by label."
- **Write back to GitHub**: a switch row each, saved at once:
  - **Close the issue when the Task is Done**: "Puts "Fixes #n" in the commit message and the pull request. GitHub closes the issue when the change reaches the default branch.";
  - **Comment when the Task starts and when it is Done**: "The Done comment links the pull request, or names the commit when publishing merges.";
  - **Close the issue when the Task is Dropped**: "Closes it as not planned, with a comment giving the Drop reason."
- A refused save shows under the card.

### Import issues window

- Opened by **Import issues…** here (on this Project) and on the Work board's filter bar ([work-board.md](work-board.md#filter-bar)).
- Medium, "Import issues", kept at one height while the list changes; picked rows are unsaved input, so closing asks first.
- At the top, with more than one Project on GitHub, a hidden-label **Project** select listing only those, which clears the picks; then a search box ("Search by title, number, label or author") over the issues already read, which isn't unsaved input.
- The list "Open issues": the repository's open issues not yet imported, newest first, pull requests left out, up to 500; past that a last row "Showing the newest 500." with a link to search on GitHub.
- Each row is one press target toggling its checkbox: "#<n>", the title, its labels and "opened by <login>, <when>", and at its right the Kind its Task gets (Bug with a `bug` label, any case, else Feature).
- The head's checkbox ("Pick every issue shown") picks or unpicks every row shown, up to 50; once 50 are picked the other rows are disabled with "Import these 50 first: at most 50 at a time."
- The bar: **Import <n> issues** (**Import issues** with none picked, waiting with "Pick the issues to import first."), and "Each becomes a Task in Backlog with Normal priority."
- After Import the window closes and toasts "<n> Tasks added to Backlog.", naming each skipped issue ("#<n> was already imported.").
- Loading: the shared loader "Loading the open issues…". Empty: "No open issue is left to import." with "Every open issue is already imported, or the repository has none. An issue opened on GitHub shows here."
- The permissions prompt shows at the top while the App lacks the Issues permission.
- In place of the list: signed out, "Sign in with GitHub in Settings › Office identity to import issues." with **Open Settings › Office identity**; a repository not on GitHub, the service's words; another refusal, "The open issues can't be read". A refused import shows "The issues weren't imported".

## Run environment

- Card **Run environment** (container icon); the badge **Not decided yet** while no setting has been picked.
- Text: "With Run environment On, the Project's checks run in the containers its .devcontainer/ defines; until then they run on this computer."
- A row **Run environment** with an **On** / **Off** segmented control, saved at once; toasts "Checks in <name> run in its run environment." or "Checks in <name> run on this computer."
- A row **.devcontainer/** with the badge **Valid** (success), **Not valid** (warning) or **Not found**, "on <base branch>, as last fetched"; a not valid definition lists each problem.
- After a "Set up the run environment" Task was Done but its `.devcontainer/` isn't valid: "The last Off-board Task was Done, but the .devcontainer/ on its branch isn't valid, so Run environment stayed as it was:" with the problems.
- **Set up run environment** (wrench icon): shown unless it is On with a valid definition; note "With a valid .devcontainer/ on the base branch it turns On at once; otherwise Devops writes one in an Off-board Task that starts now." ([2.1.3](../2.1.3-tasks.md#setting-up-the-run-environment)). Toasts: "Run environment is On: <name>'s .devcontainer/ is valid.", "<Person> is setting up <Project>'s run environment." or "<title> is queued, place N: <reasons>."; a refused start shows **Nothing was set up** with the reasons.
- With an open "Set up the run environment" Task, the button is replaced by that Task as [Following an Off-board Task](#following-an-off-board-task) shows it, with "Run environment turns On when it is Done." while Queued or Running.
- Once that Task is Done and Run environment is On with a valid definition: the success alert "Run environment is On: <name>'s .devcontainer/ is valid." over "Set up in the Off-board Task <title> · Done on <day> · <N> tokens", the title a link to the Task.
- A refused change shows the service's reasons under the block (a refused On shows why).

## Devices

- Card **Devices** (smartphone icon) with **Add a device** at its end.
- Note: "Phones and boards kept for <Project>, so an Action or a test target reaches them with nobody connecting them first."
- With the Project's Run environment not On, the warning "Needs Run environment On: a device is paired and used in the run environment." with a link to the [Run environment](#run-environment) section; its devices stay listed, and Add a device and Pair again are disabled, saying so.
- With none: "No devices yet. Add a phone or a board, then name it in an Action or an Install on a device test target."
- A list, one row per device in the order added:
  - its name, and a badge for its kind (**Android phone over USB**, **Serial board over USB**, **Android phone over wireless debugging**);
  - its state: at rest **Paired** (success), **Didn't answer** (warning), **Not paired** (warning) or **Over USB** (neutral), or **In use** (info) with "by <holder>", the Task, the Action run or the test instance linked;
  - for a phone over wireless debugging, `<address>:<Port>` in monospace;
  - its last use: "Last used by <the run or Task> · <when> · <how it ended>" (given back, tab closed, Task ended, device unplugged, Run environment turned Off, Connected devices switched off, error), or "Not used yet";
  - a pencil ("Rename <name>"), for a phone over wireless debugging **Change Port** and **Pair again**, and a trash ("Remove <name>").
- **Didn't answer** adds the line "Turning wireless debugging off and on changes its Port: change it here, or pair it again."
- **Rename** edits the name in place, at most 60 characters; **Save** and **Cancel**; toast "<name> renamed."
- **Change Port** opens a small window, "Change <name>'s Port", with **Port** (hint "The number after the colon on the phone's Wireless debugging screen.") and the note "No pairing needed: the phone trusts <Project>'s key until office@<project> is removed from its paired devices."; **Save**; toast "<name>'s Port saved."
- The trash is disabled while the device is in use, saying "In use by <holder>: remove it once it is let go of."; a remove asks nothing else; toast "<name> removed from <Project>'s devices. The phone keeps trusting <Project>'s key until you remove it there.", a device over USB's without its second sentence.
- A refusal shows under the card as the service words it (**The device wasn't saved**).
- It follows `project-device.changed`.
- Rules: [2.13](../2.13-connected-devices.md#a-projects-device), [2.13](../2.13-connected-devices.md#removing-a-project-device).

### Add a device

- **Add a device** is a menu, as the Task page's Connect a device is ([task-page.md](task-page.md#devices)): **Android phone over USB** and **Serial board over USB**, each opening the browser's own device picker, then a divider and **Phone over wireless debugging**.
- A USB choice this browser can't reach is greyed with why under its name: "Needs Chrome or Edge", or "Needs The Office over HTTPS or localhost".
- **Over USB:** the device picked is added by its device key, its name the one the browser reports; the browser lets go of it at once, as nothing is connected at rest; toast "<name> added to <Project>'s devices."
  - The note under the list: "A device over USB works in Chrome and Edge only. A run that uses it starts from a browser it is plugged into, which remembers it, and that tab stays open until the run lets go of it."
- **Over wireless debugging:** the window **Add a phone over wireless debugging**, with the four fields, hints and checks of the Task page's Pair over wireless debugging ([task-page.md](task-page.md#devices)), the note "Pairing starts a pairing environment from <base branch>'s .devcontainer/ and removes it once done.", and **Pair**.
  - **Pair** empties the Pairing code field as it sends; the device is added Not paired and the window shows the pairing's steps as they pass: "Starting the pairing environment…", "Pairing with the phone…", "Reading its model…".
  - Paired: the window closes with the toast "<model> paired with <Project>."
  - A failed pairing stays in the window in the service's or adb's words ([2.13](../2.13-connected-devices.md#android-phone-over-wireless-debugging)); the device stays listed Not paired, and **Pair** tries again with a new code.
  - A refusal before pairing (an address the run environment can't reach, a phone already among the Project's devices) shows in the window as the service words it (**The phone wasn't paired**).
- **Pair again** opens the same window, titled "Pair <name> again", its IP address and Port filled in.
- Rules: [2.13](../2.13-connected-devices.md#pairing-a-project-device), [2.13](../2.13-connected-devices.md#a-project-device-over-usb), [2.13](../2.13-connected-devices.md#browsers-supported).

## Test targets

- Card **Test targets** (flask icon) with **Ask <Person> to set up test targets** (message icon) at its end, naming the holder of Onboards and repairs Projects, while no chat or "Set up test targets" Task made before is followed and that person can chat ([2.12](../2.12-test-instances.md#set-up-test-targets)).
- Note: "What can be launched on a branch to try the work. Kept in The Office, never in the repository."
- With none: "None yet. Add one, or have <Devops> set them up from the repository."
- A list, one row per target in the order added: its name, badges for its key (monospace) and kind (**Hosted**, **Build to install** or **Install on a device**), its entry point in monospace (Install on a device: "Installs <target> on <device>"), and a mark of who set its values last, "Set by you" or "Set by <Agent>", naming each when they differ ("Set by you and <Agent>"); a pencil ("Change <name>") and a trash ("Remove <name>").
- A row with a Secret variable whose value isn't typed yet shows the warning "Needs a value: <NAME>".
- Under the entry point, a row shows its details joined by " · ", each only when it applies: "Commands before: <keys>", a Hosted target's port as `<port variable>=<port>` (`PORT=3000`), and "Memory per service <N> GB" when it has its own.
- A row listing a command the Project no longer has shows the warning "<key> isn't one of the Project's commands anymore."
- An Install on a device row whose target or device is gone shows the warning "<target> isn't one of <Project>'s Build to install targets anymore." or "<device> isn't one of <Project>'s devices anymore."
- **Add a test target** and the pencil open the editor in place (one at a time; **Save** and **Cancel**):
  - **Key** (hint "Lower-case letters, digits and "-"; fixed once added.", placeholder `web`), shown as a badge once added;
  - **Name** (placeholder "Web app");
  - **Kind**: a segmented control **Hosted** / **Build to install** / **Install on a device**; **Deployed elsewhere** is shown disabled, titled "Not built yet";
  - Install on a device takes only its two settings, in place of the entry point, the commands, the variables and the memory below ([2.12](../2.12-test-instances.md#install-on-a-device)):
    - **Build to install target**, a select of the Project's Build to install targets (hint "Its files are what is installed: reused when it has Built the same commit, built first otherwise."); with none, "Add a Build to install target first.";
    - **Device**, a select of the Project's Android phones, each with its kind badge and state ([Devices](#devices)); with none, "<Project> has no Android phone among its devices." with a link "Add one under Devices";
  - **Entry point**: a select of **File in the repository**, **Package script**, **Gradle task** and **.devcontainer/ service**, then the path, script, task or service, and **Arguments**, one per line, each given as it is; hint "One of the repository's own entry points: no shell.";
  - **Commands before the entry point**: the listed commands in order, each its place, key (monospace) and name with arrows "Move <key> up" and "Move <key> down" and an x "Remove <key>", and **Add a command**, a select of **Install** (`install`, when the Project has an install command) and the Project's commands, those not listed yet (hint "One of the Project's commands, run in the checkout before the entry point, in this order."; "Every command is listed" once none is left); a listed key the Project no longer has is flagged "<key> isn't one of the Project's commands anymore.";
  - Hosted: **Port** (hint "The port the app listens on inside its container.") and **Port variable** (monospace, placeholder `PORT`, hint "The variable The Office sets to the port.");
  - Build to install: **Output files**, one pattern per line (placeholder `composeApp/build/outputs/apk/debug/*.apk`);
  - **Variables**, one `NAME=value` per line, and **Secret variables**, as in Environment (a value never shown again once saved);
  - the note "Test values only: a test instance never gets the Project's own variables. The Office sets `OFFICE_TEST_INSTANCE=true` and `<port variable>` to the port." (Build to install: without the port part);
  - **Memory per service**: empty, it reads "Office default (N GB)", N the Office-wide value, with **Set its own limit**; set, a stepper in GB with the Office-wide setting's bounds and steps, with **Use the Office default**; hint "The most memory each of its services may use, in place of the Office-wide value in Settings › Office limits.", plus, for a Build to install with Run environment not On, "Run environment isn't On, so it builds on the workstation, which ignores it.";
  - the note "Tool settings go in the variables or the entry point's arguments, such as `-Dorg.gradle.jvmargs=-Xmx2g` for a Gradle task."
- Each value the editor saves is marked set by you; in the editor each value shows who set it last.
- Toasts "<name> saved. It applies from its next launch.", "<name> added.", "<name> removed."; a refusal shows under the editor as the service words it (**The test target wasn't saved**).
- A Hosted or Install on a device target with the Project's Run environment not On shows the warning "Needs Run environment On to launch." with a link to the Run environment section.
- **Ask <Person> to set up test targets** starts the chat Thread "Set up test targets: <Project>" and opens the chat drawer on it with the draft "Can you set up the test targets of <Project>? Read its repository, change no file, and propose them." waiting; a refusal shows **Nothing was asked**.
  - While nobody holds the duty: "Nobody onboards Projects yet: give Onboards and repairs Projects to someone in People."
- The chat followed shows in place of the button: a badge, a title, **Open the chat** (the chat drawer on that Thread) and **Ask again** (not while its Proposal is open):
  - **Draft waiting**: "Asked <Person> in a chat", with "Your draft waits in the chat for you to send it.";
  - **Answering**: "<Person> is reading the repository", with the person, "For <time>" and "In a chat, on the base branch <branch>";
  - **Waiting on you**: "<Person> replied in the chat";
  - **Proposal ready**: "<Person> proposed them in the chat", with "Apply or dismiss the Proposal below; the list stays as it is until it is applied."
- It ends once that Thread's Proposal is applied or dismissed, and the button shows again.
- A "Set up test targets" Task made before, while open, shows in place of the button with its title and state, a link to it, and "Made before test targets were set up in a chat. It works as before; once it is Done or Dropped, the button asks in a chat."
- **The open Proposal:** while Devops' `propose_test_targets` Proposal waits, its card shows above the list ([decision-card.md](decision-card.md)):
  - each change as it was and as proposed, a removal struck through;
  - each value the user set, which it changes, flagged "You set this";
  - **Apply** (all or nothing) and **Dismiss**; a refused Apply names each value changed since it was drafted.
- Rules: [2.12](../2.12-test-instances.md#test-target).

## Test instances

- A card **Test instances** (flask icon) after Test targets, in the same section, with the note "Launch a test target on any branch. One launched on an active Initiative's branch shows on its page too."
- With no Hosted, Build to install or Install on a device target: "<Project> has no test targets to launch yet." with a link "Add one under Test targets".
- **Branch**: [the Branch picker](#the-branch-picker); the instances below are those of the branch it means.
- A row per Hosted, Build to install or Install on a device target on the branch picked, as on the Initiative page ([initiative-page.md](initiative-page.md#test-instances)): **Launch**, **Stop**, **Log**, **Open**, **Download**, **QR code**, **Launch again**, and the earlier instances folded.
- An Install on a device row's newest instance also shows:
  - **Installing** (info, spinner) with "on <device>", **Stop** and **Log**;
  - **Installed** (success) with "on <device>" and **Log**;
  - while it builds, **Building** with a link "Its build", to the Build to install instance it launched; one that reused Built files says "Reusing <short commit>'s build", linked to it.
- A Build to install instance an Install launched says "Built for <target>", the Install on a device target named.
- An instance an Action launched says "Run as <Action>", linked to that Action's History ([Actions](#actions)).
- A Project whose Run environment isn't On says "Needs Run environment On to launch." on a Hosted or Install on a device target, and its **Launch** is disabled.
- Below, the other branches launched on, under "Other branches", each with its instances, the earlier ones folded.
- An instance linked to an Initiative shows "in <Initiative>", linking to its page ([2.12](../2.12-test-instances.md#linking-to-an-initiative)).
- A Notification of an instance linked to none opens Test targets with `testInstance=<id>`: its branch is picked, an earlier instance's fold opens, and its row scrolls into view ([2.7](../2.7-notifications.md#test-instance-outcomes)).
- A refusal is a toast "<name> can't launch" with the service's reason, as on the Initiative page; a branch that isn't in the Project or on its remote is refused naming it, and an Install on a device whose device is in use names its holder.
- Rules: [2.12](../2.12-test-instances.md#test-instance), [2.12](../2.12-test-instances.md#test-instance-states).

## The Branch picker

- What a test instance launches on or an Action runs from: a searchable select, used by the [Test instances](#test-instances) card and [the Run window](#the-run-window).
- Three groups, searched together by name, title and branch:
  - **Branches**: the base branch first (badged "base branch"), then the other branches of the repository and its remote, by name;
  - **Initiatives**: the active Initiatives with a branch in this Project, by name, meaning their branch;
  - **Tasks**: the Project's Tasks with a branch, not Done or Dropped, by title, meaning their branch.
- Each choice shows the branch it means in monospace, under an Initiative's name or a Task's title.
- The base branch is chosen until the user picks another.
- It is read when it is opened (`GET /projects/:id/branches?fetch=1`), with "Fetching branches…" meanwhile, and a refusal, or a warning that some may be missing when the fetch failed.
- No match: "No branch, Initiative or Task matches."
- A Task's branch holds what The Office last committed; the Task choice says so on hover: "Its branch as last committed: work not committed in its worktree isn't in it."
- Rules: [2.15](../2.15-actions.md#what-it-runs-from), [2.12](../2.12-test-instances.md#test-instance).

## Actions

- Shown while the Project's `actions` feature switch is on; while it is off, there is no Actions tab and its address says "Actions are switched off for <Project>." ([2.15](../2.15-actions.md#the-actions-feature-switch)).
- Layout: the list on the left and the open Action's History on the right, as [Pipelines](#pipelines) lay out; at a pane width of 952px and under only the list or the open Action shows, the Action with a back link "‹ <Project>'s Actions".
- Nothing open: "Open an Action to see its runs."; a key the Project lacks: "<Project> has no such Action: it may have been removed."
- It follows `action-run.changed` and the Project's changes.
- Rules: [2.15](../2.15-actions.md).

### The Actions list

- A list named "<Project>'s Actions" with a count, **Add an Action** and **Ask <name> to propose Actions** (Ask Devops, draft "Can you propose Actions for <Project>? ") at its head; while nobody holds Onboards and repairs Projects, a note says so instead of Ask.
- Note: "Things to run on demand, outside the Task queue. Kept in The Office, never in the repository."
- With none: "No Actions yet. Add one, such as an install on a phone or a release, or have <name> propose them from the repository.", with **Add an Action** and **Ask <name> to propose Actions**.
- One row per Action in the order added, linking to its History:
  - its name, and a badge for its key (monospace);
  - its kind with what it runs: "Project command · `<key>`", "Test target · <target name>" or "Workflow · `<file>`";
  - the **Leaves the workstation** badge (warning) when it has it, with its words on hover: "It pushes, publishes, deploys or releases. It runs from <base branch> only, after a confirm step.";
  - its last run's state: **Running** (info, spinner), **Succeeded** (success), **Failed** (danger, with why on hover) or **Stopped** (neutral); a Test target run's its test instance's state, a Workflow run's **Starting**, then its CI run's status badge ([ci-runs.md](ci-runs.md#table)); "Not run yet" before its first;
  - under it, what the last run ran from and when: "main · f00ba12 · 18 min ago", "<Task title> · <short commit> · …", "<Initiative> · …";
  - a mark of who set its values last, as a test target's: "Set by you", "Set by <Agent>" or "Set by you and <Agent>";
  - **Run** (play icon), which opens [the Run window](#the-run-window); disabled while its last run is running, saying "<Action> is running already, started by <user> <when>.";
  - a pencil ("Change <name>") and a trash ("Remove <name>").
- A row whose setting names something the Project no longer has shows the warning naming it: "<key> isn't one of the Project's commands anymore.", "<target> isn't one of <Project>'s test targets anymore.", "<device> isn't one of <Project>'s devices anymore." or "<file> doesn't declare a start by hand on <base branch> anymore."
- A Project command Action naming a device, with Run environment not On, shows the warning "Needs Run environment On to run." with a link to the Run environment section, and its **Run** is disabled.
- The trash removes at once, but for a running Action, which first asks in a step: "Remove <name>? Its running run stops first. Its runs and their logs are removed with it."; toast "<name> removed."

### The Action editor

- **Add an Action** and the pencil open a large window "Add an Action" or "Change <name>", keeping one height; **Add the Action** or **Save** and **Close** in its bar.
- **Key** (hint "Lower-case letters, digits and "-"; fixed once added.", placeholder `install-phone`), shown as a badge once added.
- **Name** (placeholder "Install on my phone"; at most 60 characters).
- **Kind**: radios, each with its line:
  - **Project command**: "Runs one of <Project>'s commands in a fresh checkout of what you pick.";
  - **Test target**: "Launches one of <Project>'s test targets on what you pick.";
  - **Workflow**: "Starts one of the repository's workflows on the code host, on the branch you pick."
- Project command:
  - **Command**, a select of the Project's commands, each its key (monospace) and name;
  - **Commands before it**, as the test target editor's Commands before the entry point ([Test targets](#test-targets)), hint "Run in the checkout before the command, in this order.";
  - **Device**, a select of **None** and the Project's devices, each with its kind badge (hint "Held by the run while it runs. Needs Run environment On."); with none, "<Project> has no devices yet." with a link "Add one under Devices";
  - **Time limit**: empty, it reads "Default (60 minutes)" with **Set its own limit**; set, a stepper in minutes, 1 to 240, a minute a press up to 10 and 5 above, with **Use the default**; hint "Its commands before it included.";
  - the note "It gets <Project>'s variables and Secret variables, and `OFFICE_ACTION`, `OFFICE_ACTION_BRANCH` and `OFFICE_ACTION_COMMIT`; never The Office's own sign-ins. A token it needs goes in a Secret variable."
- Test target: **Test target**, a select of the Project's test targets, each with its kind badge (hint "Build to install and Install on a device are what it is meant for; a Hosted target runs as long as its instance does."); with none, "<Project> has no test targets yet." with a link "Add one under Test targets".
- Workflow:
  - **Workflow file**, a select of the workflows on the base branch whose file declares a start by hand, read as the Start a workflow window reads them ([ci-runs.md](ci-runs.md#start-a-workflow-window)): "Reading the workflows on <base branch>…", or "No workflow on <base branch> can be started by hand.";
  - one control per input it declares there, as that window's, hint "Fixed with the Action: nothing is asked at its start.";
  - an input the Action fixed that the file no longer declares is a warning, "<input> isn't an input <file> declares on <base branch> anymore; saving leaves it out."
- **Leaves the workstation**, a checkbox with the hint "It pushes, publishes, deploys or releases: anything that reaches people or systems outside this Office. It then runs from <base branch> only, after a confirm step."; ticked when Workflow is chosen, for a new Action or one changed to it, and the user may clear it before saving or later; the service keeps what the editor saves.
- Each value the editor saves is marked set by you; in the editor each value shows who set it last.
- Toasts "<name> added.", "<name> saved. It applies from its next run."; a refusal shows in the window as the service words it (**The Action wasn't saved**), naming the value: a key taken, a command, target, device or Workflow the Project doesn't have, an input the file doesn't declare, a Project variable named as one The Office sets.
- Rules: [2.15](../2.15-actions.md#kinds), [2.15](../2.15-actions.md#leaves-the-workstation), [2.15](../2.15-actions.md#what-the-office-sets).

### The open Proposal of Actions

- While Devops' `propose_actions` Proposal waits, its card shows above the list, as the test targets' does ([Test targets](#test-targets), [decision-card.md](decision-card.md)): each change as it was and as proposed, a removal struck through, each value the user set flagged "You set this", **Apply** (all or nothing) and **Dismiss**.
- A Leaves the workstation mark it adds is flagged "Marks it Leaves the workstation".
- Rules: [2.15](../2.15-actions.md#defining-actions).

### The Run window

- A medium window "Run <Action>", keeping one height, opened by **Run** on the list, the Actions tile or the open Action.
- **Run from**: [the Branch picker](#the-branch-picker), the base branch chosen.
- What it will run: the tip of the branch it means, as its short commit (monospace) and its subject, read as it is chosen ("Reading <branch>…"), with what reading it found when it can't.
- A line of what it runs: "Runs `<key>` (after `<keys>`)", "Launches <target>; it shows in Test instances." or "Starts `<file>` on the code host with its fixed inputs."
- A run that holds a device over USB (the Action's own, or its Install on a device target's) adds "Keep this tab open until the run lets go of <device>." and may open the browser's picker as it starts; in a browser without WebUSB or Web Serial **Run** is disabled, "Needs Chrome or Edge to reach <device>."
- **Run** (play icon, primary) starts it; the window closes with the toast "<Action> started on <branch>.", and its row, its tile line and its History show it Running.
- **For an Action that leaves the workstation**, the window is a confirm step ([6](../6-permissions-and-safety.md#actions)):
  - **Run from** is fixed to the base branch, shown, not a picker, with "It leaves the workstation, so it runs from <base branch> only.";
  - the text "Run <Action> on <base branch> at <short commit> (<subject>)? What it pushes, publishes, deploys or releases reaches outside this Office.";
  - for a Workflow, its fixed inputs below it, in monospace ("dry_run=false"), so two Actions of one Workflow read apart;
  - its button, in danger: "Run <Action> on <base branch> at <short commit>", sending that commit;
  - when the branch moved since, the refusal "main moved to f00ba12 since you looked. Run it again to run that commit." shows in the window, and the commit and its button change to the new tip.
- A refusal stays in the window in the service's words (**The Action didn't start**): running already, over Actions at once or Test instances at once naming the runs that hold it, the fire alarm, a branch the remote doesn't have for a Workflow, Run environment not On, a device in use naming its holder, a test instance of The Office.
- Rules: [2.15](../2.15-actions.md#what-it-runs-from), [2.15](../2.15-actions.md#limits).

### History

- The open Action: a head card with its name, key and kind badges, what it runs, the **Leaves the workstation** badge, who set it, **Run**, the pencil and the trash.
- Card **History** below it: its runs, newest first, one row each:
  - its state badge, as the list's;
  - what it ran from: the branch in monospace, or the Task's title or the Initiative's name, linked, with its branch;
  - its short commit (monospace);
  - who started it ("you" for yourself) and when;
  - how long it took, or "for <n> min" while running;
  - why, for Failed or Stopped;
  - a Test target run's "Test instance", linked to it in Test instances (`/projects/$projectId/test-targets?testInstance=<id>`); a Workflow run's "<workflow> #<number>", linked to its page on the code host.
- A press on a row opens its log.
- With none: "Not run yet. Run it to see its runs here."
- Foot: "The newest 20 runs are kept with their logs."
- A Notification of a run opens its Action's History with `?run=<id>`: the row scrolls into view and its log opens ([2.7](../2.7-notifications.md#action-run-outcomes)).
- Rules: [2.15](../2.15-actions.md#history), [2.15](../2.15-actions.md#action-runs-kept).

### A run's log

- A large window "<Action> · <state>", keeping one height, as a test instance's Log window is ([initiative-page.md](initiative-page.md#test-instances)); its address carries `?run=<id>`.
- Under its head: the state, what it ran from at its commit, who started it and when, and how long it took.
- The masked log in monospace, The Office's own lines (the checkout, each command named first, how it ended) set apart from the output, and why it failed in danger.
- While the run is running it streams, reading on from where it is; **Follow** (on at first) keeps the newest line in view, and scrolling up turns it off.
- A Test target run's log is its test instance's, with **Open the test instance** in the bar.
- A Workflow run's log is its start, its inputs and the CI run's link; **Open the CI run** in the bar opens its page on the code host in a new tab, and it has no Stop.
- Its bar: **Stop** (danger) while a Project command or Test target run is running, asking nothing (toast "<Action> stopped."), then **Close**.
- Rules: [2.15](../2.15-actions.md#log), [2.15](../2.15-actions.md#when-a-run-stops).

## Engine

- Card **Engine** (cpu icon); note "The most specific level wins: the Project's Role overrides, then the Role overrides on the Role cards, then a Task's engine, then its Initiative's engine, then the Project default, then the Office default."
- Every change saves at once; while one saves, the controls are disabled; a refusal shows under the block until the next change.
- **Project default**: the engine and model pair (the same fields as the Role card); the "Office default" choice clears it and is offered only while **Use for every Role** is off. Toasts "Project default saved for <name>." / "<name> has no Project default now."
- **Use for every Role** switch: disabled with "Pick a Project default first." while there is no Project default; otherwise "The Project default wins over the Role overrides on the Role cards, and so does a Task's or an Initiative's engine set in its place; the Project's Role overrides still apply." Toasts "Every Role in <name> runs on its Project default, past their Role overrides." / "Role overrides apply in <name> again."
- **Role overrides in this Project**: a list of rows, each a Role name, its engine and model pair and **Remove**; below it **Add a Role override** (a group: **Role** select, "Pick a Role"; the engine and model pair, starting from the first engine's default model; **Add**), offering only Roles not let go and not already overridden. Toasts "<Role> has a Role override in <name>." / "<Role>'s Role override in <name> is removed."
- The engines offered are the Role card's options.

## Skills

- Card "Skills in the repository <count>" (sparkles icon).
- None found: "The repository has no `.claude/skills`. Skills from the library are given per Role in Settings › Skills."
- Otherwise a switch **Use this Project's skills** (description "Anyone working in <name> gets the ones turned on below, besides their Role's skills."; toasts "Sessions in <name> get its own skills from their next start." / "Sessions in <name> start without its own skills.") and a row per skill:
  - A chip with its name, its description, its path in monospace, and "Not used in the last 7 days", "Used once in the last 7 days" or "Used N times in the last 7 days" (counted by the skill's key, so rows sharing a key show the same count).
  - A switch (its row is a group named by the skill), disabled while the Project's skills are off or a save runs; off rows are dimmed; toasts "Sessions in <name> get <skill> from their next start." / "Sessions in <name> start without <skill>."
  - "Listed once a file below it is read." when it isn't listed at start.
  - "Switches together with <paths>: a session knows them as one skill." for rows sharing a key.
  - A warning "The library has a skill of this name too; a session with both lists both." when the library has one and sessions get it.
- Note: "Read-only: they live in the repository, and The Office neither stores nor copies them. Change them with a Task."
- The switches save in turn, so answers land in order. A refusal shows under the block or the row.

## Server values

- Card **Server values** (plug icon); note "A value set here wins over the Office-wide one in this Project's sessions; chat uses the Office-wide values."
- No MCP server with Server values: "No MCP server in the library has Server values. Add servers in Settings › MCP servers." (a link).
- A section per MCP server, "MCP server <name>": its name and a pencil ("Change <name>'s values for this Project"), then a row per value: its name, **Office-wide** (the value, "Set" for a secret, or "Not set") and **This Project** (the value, "Set" for a secret, or "The Office-wide value"); a required value set nowhere shows "Required: sessions leave the server out until it has a value."
- Editing one server (Save and Cancel; one at a time): a field "<name> for this Project" per value; a plain value's hint is "Empty: the Office-wide value applies, <value>." or "Empty: no value, as none is set Office-wide."; a secret uses the secret box (shows set or not, never the value). Every value is sent back, a kept secret by its name alone, and one left out is cleared.
- Toast "Server values saved. Sessions in <name> get them from their next start." A refusal shows under the block.

## Features

- One row per feature, each with a switch and a one-line hint, saved at once ([Feature switches](../2.1.1-projects.md#feature-switches)):
  - **Connected devices**, hint "Devices connected to a Task or kept for the Project.";
  - **Test targets**, hint "What can be launched on an Initiative's branch to try the work.";
  - **GitHub issues**, hint "Import issues as Tasks and write back to them.";
  - **Run environment**, hint "Checks run in the containers .devcontainer/ defines."; it shows and writes the Project's Run environment setting ([Run environment](#run-environment)), "Not decided" showing as off;
  - **Actions**, hint "Things to run on demand, outside the Task queue."; on unless set.
- A switch whose needed feature is off is disabled, saying "Needs Run environment".
- Turning one off turns off the features that need it; a refused change shows the service's reasons under the block.
- The tab sits before Appearance.
- A switched-off feature's tab (GitHub issues, Run environment, Devices, Test targets, Actions) is gone from the tabs; Run environment's only while it is Off, so Not decided yet still shows its tab.
  - Devices' tab is gone only while Run environment is On and Connected devices are switched off; while Run environment isn't On the section shows, saying it needs Run environment On ([Devices](#devices)).
  - Its address shows a note, "GitHub issues are switched off for <name>.", "Run environment is switched off for <name>.", "Connected devices are switched off for <name>.", "Test targets are switched off for <name>." or "Actions are switched off for <name>.", with a link to Features; it doesn't redirect.

## Appearance

- At a pane width of 953px and over, two columns: the Mark and Images cards on the left, **How it looks** on the right, staying in view while the cards scroll.
- Under that, one column with **How it looks** first.
- **Mark** card (palette icon): the Mark picker, **Save** and, while there is a draft, **Discard**.
  - The Mark picker: a tile with the letters on the colour; the **Mark label** field (3 characters at most); a radio group "Colour" of round swatches **Teal**, **Violet**, **Gray**, **Ink** and **Custom**, shown on hover by name.
  - **Custom** keeps a colour already picked; the first time it starts from `#3366cc`. While the colour is custom, a colour input ("Custom colour") and its value show.
  - The tile always shows the letters, even when an Icon replaces them elsewhere.
  - Save is disabled until the label or colour changed (tooltip "Change the label or the colour to save."); toast "Mark saved for <name>."; the draft is dropped when it equals the saved mark, so a change from another tab shows when nothing is being edited.
  - Note, once an Icon is held: "The Icon shows in place of these letters. They come back if it is removed."
  - The Add a Project window uses the same picker ([projects.md](projects.md#step-2-the-projects-fields)).
- **Images** card (image icon): "A light and a dark version each, shown with the palette. One version alone shows in both. PNG, JPEG, WebP or SVG, at most <limit> MB. Saved as soon as picked."
  - A section each for **Icon** ("Shows in place of the mark's letters and colour, wherever the mark shows.") and **Logo** ("Stands for the Project on its page, in place of the mark.").
  - Each has a **Light** and a **Dark** version tile, shown on that palette's own page.
  - A tile: a drop zone that is also the button for the file picker ("Upload a <Palette> <Image>" / "Replace the <Palette> <Image>"); an empty one says "Drop an image or browse", and when the other version is held "Uses the <other> version"; a held one shows the image, or "The image can't be loaded."
  - Once held, **Replace** and **Remove** show in the tile's head.
  - **Choose from repository** opens a repository file window titled "Choose <Palette> <Image>" for PNG, JPEG, WebP or SVG files of the Project.
  - A save shows "Saving…" over the tile and disables its buttons ("The <name> is being saved."); toasts "<Palette> <Image> saved for <name>." / "<Palette> <Image> removed for <name>."
  - A refusal stays in the tile: "An image may be at most <limit> MB." or "The file isn't a PNG, JPEG, WebP or SVG image." (both checked before sending), or the service's words; the version stays as it was.
- **How it looks** card (eye icon): the Project as the app draws it, with the draft mark over the saved images, a **Not saved** badge while the mark is a draft, and a **Light** / **Dark** segmented control (the palette names; tooltip "Show it in the <Palette> palette"; the base of the shown palette first). Three samples, each on that palette's page with its versions of the images:
  - "On its page": the page head.
  - "In the Projects list": the list item, its mark with the name and the line under it ([projects.md](projects.md#project-item)).
  - "Beside an item, as on a Task card": the Project chip.
- The page head above keeps the saved mark until **Save**.

## States

- The Project is read: nothing shows until it is.
- Unknown Project (404): in the pane beside the list, an empty state with the service's message, a folder-x icon and the link **Back to Projects**.
- Another error: the empty state "The Project can't be shown." with the error and **Back to Projects**.
- Every section's own loading and error states are given above; a save in a block shows loading on its button.
- A block's saved answer is put in the Project's query, so the head and other blocks follow it.
- Narrow window: see [Layout](#layout).

## Domain facts

- A Project, its settings, the Project limit: [2.1.1](../2.1.1-projects.md#project).
- Project commands: [2.1.1](../2.1.1-projects.md#project-commands).
- Icon and Logo: [2.1.1](../2.1.1-projects.md#icon-and-logo).
- Onboarding: [2.1.1](../2.1.1-projects.md#onboarding-a-project).
- Off-board Tasks and setting up the run environment: [2.1.3](../2.1.3-tasks.md#off-board-tasks).
- Project Pipelines and a Broken Project Pipeline: [2.3.5](../2.3.5-library.md#project-pipelines), [2.3.5](../2.3.5-library.md#a-broken-project-pipeline).
- Which Pipeline a Task follows: [2.3.5](../2.3.5-library.md#which-pipeline-a-task-follows).
- GitHub issues: [2.1.1](../2.1.1-projects.md#github-issues).
- Publishing, Publish's before and after lines: [2.3.4](../2.3.4-publish.md#publishs-before-and-after-lines).
- Delete branches once merged: [5.5](../5.5-git-and-isolation.md#deleting-merged-branches).
- Project skills: [2.6](../2.6-skills.md#project-skills), [2.6](../2.6-skills.md#project-skills-turn-off-one-by-one).
- The engine cascade: [5.4.5](../5.4.5-engines-and-cascade.md#the-engine-cascade).
- Test targets and their Proposal: [2.12](../2.12-test-instances.md#test-target), [2.12](../2.12-test-instances.md#writing-test-targets).
- Test instances, their branch and Initiative link: [2.12](../2.12-test-instances.md#test-instance), [2.12](../2.12-test-instances.md#linking-to-an-initiative).
- Install on a device: [2.12](../2.12-test-instances.md#install-on-a-device).
- Project devices, pairing one, one environment at a time: [2.13](../2.13-connected-devices.md#a-projects-device), [2.13](../2.13-connected-devices.md#pairing-a-project-device), [2.13](../2.13-connected-devices.md#one-environment-at-a-time).
- Actions, their runs, their Proposal and the `actions` feature switch: [2.15](../2.15-actions.md); their safety: [6](../6-permissions-and-safety.md#actions).
