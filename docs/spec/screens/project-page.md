# Project page

Covers: a Project's page and its head, the section menu, Overview (Onboarding, Work, the Project limit), Files, Commands (install, install inputs, commands, Publish), Environment (variables, Secret variables, environment check), Pipelines (Default Pipeline and its rows by Kind, Project Pipelines), GitHub issues (the Import issues window, auto-import, write-back), Run environment, Test targets (the list, the editor, Set up test targets, the open Proposal), Test instances (the Branch picker, Launch on a branch, instances by branch), Engine, Skills, Server values, Appearance (Mark, Icon and Logo, How it looks).

## Where it is

- Route: `/projects/$projectId`, a parent with one child route per section.
- Open it from a card on the Projects page ([projects.md](projects.md)), or from any link to a Project.
- The page title is the Project's name; its crumb is the name, with "Projects" as its parent (back to `/projects`).
- Sections and their routes, in the menu's order:
  - **Overview**: `/projects/$projectId` (no redirect; a redirect would drop a link's `?chat=…&thread=…`).
  - **Files**: `/projects/$projectId/files?branch=&path=`.
  - **Commands**: `/projects/$projectId/commands`.
  - **Environment**: `/projects/$projectId/environment`.
  - **Pipelines**: `/projects/$projectId/pipelines`, and an open Project Pipeline at `/projects/$projectId/pipelines/$projectPipelineId`.
  - **GitHub issues**: `/projects/$projectId/issues`.
  - **Run environment**: `/projects/$projectId/run-environment`.
  - **Test targets**: `/projects/$projectId/test-targets`.
  - **Engine**: `/projects/$projectId/engine`.
  - **Skills**: `/projects/$projectId/skills`.
  - **Server values**: `/projects/$projectId/server-values`.
  - **Appearance**: `/projects/$projectId/appearance`.
- An unknown Project says so at every section's address ([States](#states)).

## Layout

- The head, at the top.
- Below it the section layout: the left-hand menu, a navigation named "Project", beside the open section.
- At a page width of 924px and under, the menu becomes a row above the section, scrolling sideways.
- The section's blocks are cards stacked in one column, 1100px at most wide.
- At a page width of 664px and under, the page padding shrinks to 14px and two-column rows stack.

## Head

- The Project's Logo (page size), its name, then a meta line: the onboarding badge (**Onboarding** or **Onboarded**, when the Project has an Onboard Task), the Project's folder path (monospace) and "· <base branch>".
- When the Project was cloned: a line "Repository URL" with the URL.
- The remote's needs line: which part of the Office identity the base branch's remote needs, and what is missing. It shows only while the Project has a remote, and changes when `github.changed` arrives.
  - GitHub over https: "Its remote is GitHub over https, reached with Sign in with GitHub."; missing: "Not signed in with GitHub."; with a link to **Settings › Office identity**.
  - ssh: "Its remote, <host>, is reached over ssh with the Office ssh key, whose public half the host needs."; missing: "The Office ssh key isn't made yet." and/or "<host>'s host key isn't confirmed yet: it becomes a Trusted host once its fingerprint is confirmed."; with the link to Settings › Office identity.
  - Anonymous https: "Its remote, <host>, is reached anonymously over https, so only a public repository can be fetched."
  - A local folder: "Its remote is a folder on this workstation, which needs nothing of the Office identity."
  - Refused scheme: "Its remote is reached by <scheme>, which The Office refuses: it reaches remotes over https and ssh only."
- The Logo is the Project's Logo, else its Icon, else its mark.

## Overview

- Two blocks: Onboarding, then Work.

### Onboarding

- Card **Onboarding** (hard-drive icon) with the onboarding badge at its end.
- With an Onboard Task: "From the Task <title> · <state words>", the title a link to the Task ([task-page.md](task-page.md)); a Task in Ready adds ", waiting for your Start".
- Without one: "None: the Project has no Onboard Task. Devops onboards a Project they are asked to add."
- It refreshes with any Task event.

### Work

- Card **Work** (kanban icon) with two links at its end:
  - **Open in Work**: goes to `/work`.
  - **CI runs**: narrows the Project filter to this Project, then goes to `/work/ci`.
- Four tiles with a count of the Project's Tasks each:
  - **Running**: Tasks In progress or Paused.
  - **Waiting on you**: the Tasks waiting on the user ([work-board.md](work-board.md)).
  - **Ready to start**: Tasks in Ready.
  - **Not planned yet**: Tasks in Backlog or Planning.
- **Running Tasks at once in this Project**: a stepper, 1 to the Project limit's maximum (`PROJECT_LIMIT_MAX`), saved at each step.
- Note: "Lowering it lets running Tasks finish; nothing new starts in this Project until one ends."
- A refusal shows under the stepper.

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
  - At a page width of 900px and under they stack.
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
- Layout: the lists on the left (the Default Pipeline card above the Project Pipelines list) and the detail on the right; at a page width of 1224px and under only the lists or the open one show, the detail with a back link "‹ <Project>'s Pipelines".
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

- Route `/projects/$projectId/issues`, after Pipelines in the section menu (circle-dot icon). Rules: [2.1.1](../2.1.1-projects.md#github-issues).
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
- After a set-up Task was Done but its `.devcontainer/` isn't valid: "The last set-up Task was Done, but the .devcontainer/ on its branch isn't valid, so Run environment stayed as it was:" with the problems.
- **Set up run environment** (wrench icon): shown unless it is On with a valid definition; note "With a valid .devcontainer/ on the base branch it turns On at once; otherwise Devops writes one in a Task." Toasts: "Run environment is On: <name>'s .devcontainer/ is valid." or "<Task title> is <state>, waiting for your Start." (the latter only in Ready).
- With an open set-up Task, the button is replaced by "Being set up in the Task <title> · <state words>. Run environment turns On when it is Done."
- A refused change shows the service's reasons under the block (a refused On shows why).

## Test targets

- Card **Test targets** (flask icon) with **Set up test targets** (wand icon) at its end.
- Note: "What can be launched on a branch to try the work. Kept in The Office, never in the repository."
- With none: "None yet. Add one, or have <Devops> set them up from the repository."
- A list, one row per target in the order added: its name, badges for its key (monospace) and kind (**Hosted** or **Build to install**), its entry point in monospace, and a mark of who set its values last, "Set by you" or "Set by <Agent>", naming each when they differ ("Set by you and <Agent>"); a pencil ("Change <name>") and a trash ("Remove <name>").
- A row with a Secret variable whose value isn't typed yet shows the warning "Needs a value: <NAME>".
- Under the entry point, a row shows its details joined by " · ", each only when it applies: "Commands before: <keys>", a Hosted target's port as `<port variable>=<port>` (`PORT=3000`), and "Memory per service <N> GB" when it has its own.
- A row listing a command the Project no longer has shows the warning "<key> isn't one of the Project's commands anymore."
- **Add a test target** and the pencil open the editor in place (one at a time; **Save** and **Cancel**):
  - **Key** (hint "Lower-case letters, digits and "-"; fixed once added.", placeholder `web`), shown as a badge once added;
  - **Name** (placeholder "Web app");
  - **Kind**: a segmented control **Hosted** / **Build to install**; **Install on a device** and **Deployed elsewhere** are shown disabled, titled "Not built yet";
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
- A Hosted target with the Project's Run environment not On shows the warning "Needs Run environment On to launch." with a link to the Run environment section.
- **Set up test targets** adds the Project's "Set up test targets" Task; toast "<Task title> is Ready, waiting for your Start."
  - With an open one, the button is replaced by "Being set up in the Task <title> · <state words>."
- **The open Proposal:** while Devops' `propose_test_targets` Proposal waits, its card shows above the list ([decision-card.md](decision-card.md)):
  - each change as it was and as proposed, a removal struck through;
  - each value the user set, which it changes, flagged "You set this";
  - **Apply** (all or nothing) and **Dismiss**; a refused Apply names each value changed since it was drafted.
- Rules: [2.12](../2.12-test-instances.md#test-target).

## Test instances

- A card **Test instances** (flask icon) after Test targets, in the same section, with the note "Launch a test target on any branch. One launched on an active Initiative's branch shows on its page too."
- With no Hosted or Build to install target: "<Project> has no Hosted or Build to install test targets yet." with a link "Add one under Test targets".
- **Branch** picker: the base branch first (badged "base branch"), then the other branches of the repository and its remote by name; read when the picker is opened (`GET /projects/:id/branches?fetch=1`), with "Fetching branches…" meanwhile and a refusal or a warning that some may be missing when the fetch failed.
- A row per Hosted or Build to install target on the branch picked, as on the Initiative page ([initiative-page.md](initiative-page.md#test-instances)): **Launch**, **Stop**, **Log**, **Open**, **Download**, **QR code**, **Launch again**, and the earlier instances folded.
- A Project whose Run environment isn't On says "Needs Run environment On to launch." on a Hosted target, and its **Launch** is disabled.
- Below, the other branches launched on, under "Other branches", each with its instances, the earlier ones folded.
- An instance linked to an Initiative shows "in <Initiative>", linking to its page ([2.12](../2.12-test-instances.md#linking-to-an-initiative)).
- A Notification of an instance linked to none opens Test targets with `testInstance=<id>`: its branch is picked, an earlier instance's fold opens, and its row scrolls into view ([2.7](../2.7-notifications.md#test-instance-outcomes)).
- A refusal is a toast "<name> can't launch" with the service's reason, as on the Initiative page; a branch that isn't in the Project or on its remote is refused naming it.
- Rules: [2.12](../2.12-test-instances.md#test-instance).

## Engine

- Card **Engine** (cpu icon); note "The most specific level wins: the Project's Role overrides, then the Role overrides on the Role cards, then the Project default, then the Office default."
- Every change saves at once; while one saves, the controls are disabled; a refusal shows under the block until the next change.
- **Project default**: the engine and model pair (the same fields as the Role card); the "Office default" choice clears it and is offered only while **Use for every Role** is off. Toasts "Project default saved for <name>." / "<name> has no Project default now."
- **Use for every Role** switch: disabled with "Pick a Project default first." while there is no Project default; otherwise "The Project default wins over the Role overrides on the Role cards; the Project's Role overrides still apply." Toasts "Every Role in <name> runs on its Project default, past their Role overrides." / "Role overrides apply in <name> again."
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

## Appearance

- At a page width of 1225px and over, two columns: the Mark and Images cards on the left, **How it looks** on the right, staying in view while the cards scroll.
- Under that, one column with **How it looks** first.
- **Mark** card (palette icon): the Mark picker, **Save** and, while there is a draft, **Discard**.
  - The Mark picker: a tile with the letters on the colour; the **Mark label** field (3 characters at most); a radio group "Colour" of round swatches **Teal**, **Violet**, **Gray**, **Ink** and **Custom**, shown on hover by name.
  - **Custom** keeps a colour already picked; the first time it starts from `#3366cc`. While the colour is custom, a colour input ("Custom colour") and its value show.
  - The tile always shows the letters, even when an Icon replaces them elsewhere.
  - Save is disabled until the label or colour changed (tooltip "Change the label or the colour to save."); toast "Mark saved for <name>."; the draft is dropped when it equals the saved mark, so a change from another tab shows when nothing is being edited.
  - Note, once an Icon is held: "The Icon shows in place of these letters. They come back if it is removed."
  - The Add a Project window uses the same picker ([projects.md](projects.md#step-2-the-projects-fields)).
- **Images** card (image icon): "A light and a dark version each, shown with the palette. One version alone shows in both. PNG, JPEG, WebP or SVG, at most <limit> MB. Saved as soon as picked."
  - A section each for **Icon** ("Shows in place of the mark's letters and colour, wherever the mark shows.") and **Logo** ("Stands for the Project on its page and its card, in place of the mark.").
  - Each has a **Light** and a **Dark** version tile, shown on that palette's own page.
  - A tile: a drop zone that is also the button for the file picker ("Upload a <Palette> <Image>" / "Replace the <Palette> <Image>"); an empty one says "Drop an image or browse", and when the other version is held "Uses the <other> version"; a held one shows the image, or "The image can't be loaded."
  - Once held, **Replace** and **Remove** show in the tile's head.
  - **Choose from repository** opens a repository file window titled "Choose <Palette> <Image>" for PNG, JPEG, WebP or SVG files of the Project.
  - A save shows "Saving…" over the tile and disables its buttons ("The <name> is being saved."); toasts "<Palette> <Image> saved for <name>." / "<Palette> <Image> removed for <name>."
  - A refusal stays in the tile: "An image may be at most <limit> MB." or "The file isn't a PNG, JPEG, WebP or SVG image." (both checked before sending), or the service's words; the version stays as it was.
- **How it looks** card (eye icon): the Project as the app draws it, with the draft mark over the saved images, a **Not saved** badge while the mark is a draft, and a **Light** / **Dark** segmented control (the palette names; tooltip "Show it in the <Palette> palette"; the base of the shown palette first). Three samples, each on that palette's page with its versions of the images:
  - "On its page": the page head.
  - "On the Projects page": the card.
  - "Beside an item, as on a Task card": the Project chip.
- The page head above keeps the saved mark until **Save**.

## States

- The Project is read: nothing shows until it is.
- Unknown Project (404): an empty state with the service's message, a folder-x icon and the link **Back to Projects**.
- Another error: the empty state "The Project can't be shown." with the error and **Back to Projects**.
- Every section's own loading and error states are given above; a save in a block shows loading on its button.
- A block's saved answer is put in the Project's query, so the head and other blocks follow it.
- Narrow window: see [Layout](#layout).

## Domain facts

- A Project, its settings, the Project limit: [2.1.1](../2.1.1-projects.md#project).
- Project commands: [2.1.1](../2.1.1-projects.md#project-commands).
- Icon and Logo: [2.1.1](../2.1.1-projects.md#icon-and-logo).
- Onboarding: [2.1.1](../2.1.1-projects.md#onboarding-a-project).
- Project Pipelines and a Broken Project Pipeline: [2.3.5](../2.3.5-library.md#project-pipelines), [2.3.5](../2.3.5-library.md#a-broken-project-pipeline).
- Which Pipeline a Task follows: [2.3.5](../2.3.5-library.md#which-pipeline-a-task-follows).
- GitHub issues: [2.1.1](../2.1.1-projects.md#github-issues).
- Publishing, Publish's before and after lines: [2.3.4](../2.3.4-publish.md#publishs-before-and-after-lines).
- Project skills: [2.6](../2.6-skills.md#project-skills), [2.6](../2.6-skills.md#project-skills-turn-off-one-by-one).
- The engine cascade: [5.4.5](../5.4.5-engines-and-cascade.md#the-engine-cascade).
- Test targets and their Proposal: [2.12](../2.12-test-instances.md#test-target), [2.12](../2.12-test-instances.md#writing-test-targets).
- Test instances, their branch and Initiative link: [2.12](../2.12-test-instances.md#test-instance), [2.12](../2.12-test-instances.md#linking-to-an-initiative).
