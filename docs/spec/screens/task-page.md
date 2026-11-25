# Task page

Covers: the Task page's head and actions, the Kind, the drop note, Start and the queue, planning actions, the Needs you card and Before Ready, the Pipeline rail and Stage history, the record's tabs (Overview, Changes, Attachments, Engine), the record blocks (the Bug section, the GitHub issue, the Devices section with Use a Project device among them, and History), the Task menu, the Delete branch window, run controls, Gate actions, Conflict resolution, publishing, and the Task's conversation.

## Where it is

- Route: `/tasks/<id>`.
- Open it from a card on the Work board ([work-board.md](work-board.md)), a link to a Task, or a Notification.
- The page title and crumb are the Task's title; the parent crumb is "Work", leading to `/work`.
- Search params: `recordTab` (`changes`, `attachments` or `engine`; none is Overview), `taskThread` (a person's tab by Role key or Thread id, or a Stage run's id to open its Stage history), `decision` (lands on that Decision's card).
- The Work tab strip shows at the top with Tasks chosen ([work-board.md](work-board.md#tabs)).
- A Task that can't be read shows a missing-record view (see States).

## Layout

- The tab strip, then the head.
- The Pipeline rail across the page, under the head.
- Below it two columns: the record on the left, the conversation on the right.
- The record column holds, top to bottom: the Needs you card, the record's tabs, the tab's content.
- The conversation sticks beside the record; its height is fitted so its foot stays in the window.
- At 900px and below the conversation is a drawer (see Conversation drawer).

## Head

- Left: the Project chip, then the title (`h2`) with its badges, then a line of facts.
- A pencil icon button "Edit the title" beside the title turns it into a text field; Enter or the check button saves, Esc or the cancel button cancels; a refusal shows its reason. Hidden on a Done or Dropped Task ([2.1.3](../2.1.3-tasks.md#title)).
- Badges: the Task's state ([2.1.3](../2.1.3-tasks.md#task-states)); "Waiting on you" when a Decision or Gate waits on the user; **Archived <day>** once archived; the Stand-in mark.
- A Task Stopped at its current Stage shows the state "Stopped" while the Task itself stays Paused; a Paused Task shown without its Stages reads "Paused".
- Stand-in mark: while a started Task's run works on Stand-in Engines, an info badge "On a Stand-in Engine: <stand-in> for <engine>" (several joined), the reasons on hover; a Stage's switch mid-run refreshes it.
- Facts line: on an Off-board Task, the badge **Off-board Task** first ([2.1.3](../2.1.3-tasks.md#off-board-tasks)); the Kind's glyph with its name ("Feature", "Bug" or "Chore", [2.1.3](../2.1.3-tasks.md#task-kind)); the priority glyph with "<High|Normal|Low> priority"; "Pipeline <name>"; the Task's tokens; its Tags.
- Pipeline fact: the Pipeline's name, with the "edited for this Task" label once the Task has its own Stages; "Pipeline Not chosen yet" while none is chosen, never "removed".
- Tokens: a plain count labelled "tokens", or a meter against the Planner's estimate when the Task has one.
- Tags: the shell's tags input, saved as each is added or removed, in any state; the last change sent wins.
- Right: the actions (see Head actions), then **More**.
- Under the head: the Off-board Task note, the Start notes (see Start and the queue), then the drop note.
- Off-board Task note: on an Off-board Task, "The Office started this Off-board Task at once and keeps it off the Work board. Follow it here or on <Project>'s page.", the last words a link to the Project page's Onboarding (an Onboard Task) or Run environment (a "Set up the run environment" Task).
- Drop note: on a Task dropped with a reason, "Dropped: won't fix", "Dropped: can't reproduce", "Dropped: <Other's words>" or "Dropped as a duplicate of <Task>" (linked, with its state badge), then when; none for a Task dropped with no reason ([2.1.3](../2.1.3-tasks.md#drop-reason)); gone once the Task is reopened, the reason staying in History.

## Head actions

- One line of buttons; whatever wraps past it is hidden, the last first, and the **More** menu always holds every action as its first items.
- The line keeps room for its first button and **More**: when the title leaves less, the actions go under the title, never a blank where a hidden button was.
- In order: planning actions, Start or the queue's actions, run controls, **Open pull request**, **Browse files**, **Restore**.
- Each is coloured by its tone, in the buttons and in **More** ([Action tones](../4.1-ui-rules.md#action-tones)).
- Planning actions: **Plan with <Planner>** and **Mark Ready** (see Planning actions).
- Run controls: **Pause**, **Stop**, **Resume**, **Restart from…**, **Start over** (see Run controls).
- **Reopen…**: on a Dropped Task, after the planning actions (see Reopen window).
- **Open pull request**: a link in a new tab, shown once the newest finished Publish opened a pull request, or the ended pull request's address is known.
- Once the pull request ended, a badge sits beside it: "Pull request merged" or "Pull request closed"; hover says the method, who ("on GitHub" for the code host) and when.
- The Task's record gets a line for it, such as "Pull request #12 (<url>) merged (squash) by the user Ann Lee on …".
- **Browse files**: a link to the Project's Files tab with `?branch=office/<task id>` (a Publishing Task's: its Initiative's branch), shown only while that branch is known on this workstation; it never fetches.
- **Restore**: shown on an archived Task; one click, no confirmation; the Task is back on the board in the state it had.

## Task menu

- **More for <title>** (ellipsis).
- First the head's actions, then:
- While not started: a **Priority** heading with **High**, **Normal**, **Low**, a check on the current one; choosing one toasts "<title> is now <priority> priority."
- Until it ends: a **Kind** heading with **Feature**, **Bug**, **Chore**, each with its glyph and a check on the current one; choosing one toasts "<title> is now a <Kind>." ([2.1.3](../2.1.3-tasks.md#task-kind)).
- **Archive**: on a Done or Dropped Task that isn't archived.
- **Edit Stages for this Task**: until it ends, never in Shaping; opens the Stage editor (see Edit for this Task).
- **Move to another Project…**: until it ends; shown even where it is refused, as its window says why.
- **Delete branch…**: on a Done or Dropped Task while its branch `office/<task id>` is known here, locally or as a remote-tracking ref (`GET /tasks/:id/branch`, no fetch); a Publishing Task and a Conflict resolution Task show none (see Delete branch window).
- **Reopen…**: on a Dropped Task, as in the head; on an archived one it is offered once the Task is Restored.
- A divider, then **Drop…** (danger), until it ends.
- Drop… opens "Drop <title>?" (Small) with the button **Drop the Task**; it says the Task moves to Done as dropped, stays readable there, and can be reopened later; a refusal shows as "The Task can't be dropped"; success toasts "Task dropped."
- Its optional **Reason** (hint "Optional."): a radio list of **Won't fix**, **Duplicate**, **Can't reproduce** and **Other**, none picked at first; pressing the picked one again clears it ([2.1.3](../2.1.3-tasks.md#drop-reason)).
  - What Duplicate and Other ask shows right under them while picked.
  - Duplicate shows "Find a Task by its title", a searchable select of every other Task in any Project and state, with the hint "The Task this one duplicates. Required for Duplicate."; Drop the Task waits with "Pick the Task it duplicates".
  - Other shows a required box of three rows, up to 500 characters; Drop the Task waits with "Write the reason first".
  - When the Task has a GitHub issue and its Project closes issues of dropped Tasks: "GitHub issue #<n> will be closed with this reason, as <Project> closes issues of dropped Tasks."
  - A picked reason is unsaved input, so closing asks first.

## Delete branch window

- "Delete <branch>?" (Small), shared with the Initiative page; it judges the branch as it opens (`GET …/branch-deletion`, fetching first), with "Checking the branch…" meanwhile ([5.5](../5.5-git-and-isolation.md#deleting-merged-branches)).
- It lists what goes: the local branch, the remote copy (`origin/<branch>`), and the worktree when one holds it.
- **Safe:** "Everything on it is in <base branch>." with the button **Delete branch** (danger).
- **Holds work:** a warning "It holds <n> commits <base branch> doesn't have; they are lost once it's deleted:" with up to 5 commit subjects and "and <m> more"; for an Initiative's branch also the Tasks landed on it that no Publish took to the base, by title; the button **Delete anyway** (danger).
- **Refused:** the reason as a danger alert, and no button.
- The delete sends the commits it judged; a branch that moved meanwhile is refused "The branch changed since it was checked; check again."
- A refusal of the delete shows in the window as a danger alert; success closes it and toasts "Branch <branch> deleted."

## Move to another Project

- Window "Move <title> to another Project", button **Move**.
- It reads the service's check first; while it refuses, an alert "This Task can't move to another Project" lists the reasons and only Close is offered.
- Otherwise: "It is in <Project> now.", then "Move it to" with the other Projects as radios.
- With no other Project: "There is no other Project to move it to. Add one on the Projects page first."
- It lists what the Move does: no Pipeline in the new Project until one is chosen and Stages edited for this Task are set aside; its state (Shaping stays Shaping until its Initiative is confirmed; Ready goes back to Backlog and out of the queue; otherwise it stays in Backlog); its Plan and Definition of Done keep their words, both Not confirmed; its Initiative, dependencies, Attachments and Threads stay with it.
- A refusal shows as "The Task can't be moved"; success toasts "<title> is in <Project> now."
- The Description's Origin section shows where the Task moved from.

## Start and the queue

- **Start**: on a Ready Task; disabled until the start check is read or while a refusal (such as a vacant Role) holds it; it starts the Task and toasts "<title> started."
- With an Overlap with a Task in progress: **Start anyway** (primary) and **Queue behind it**.
- With a blocker (a Task it waits for): only **Queue behind it** (**Queue behind them** for several), counting its blockers and Overlaps together.
- A Start that only joins the queue toasts "<title> is queued, place <n>: <reasons>".
- A queued Task shows, instead of Start: **Move up** (a split button whose menu holds **Move to top**; none for the first place), and **Take out of the queue**.
- While only its usage holds it ([2.1](../2.1.5-planning-and-start.md#start-anyway-past-the-usage-caps)), **Start anyway** (primary) comes first; disabled, with why on hover, while every engine its Stages could run on has a used-up window.
  - It asks first in a dialog, "Start <title> anyway?": the caps it passes ("It starts now, past these usage caps:", one per line, such as "Personal: 5-hour window cap (90%) · resets 14:30"), the engines it runs on ("Its Stages run on Personal, standing in for Work."), and that its Usage estimate counts as usual; **Start anyway** starts it and toasts "<title> started.", and a refusal shows in the dialog.
- Take out of the queue toasts "Taken out of the queue; it stays Ready."
- Start notes, a line each, in a block under the head, none with nothing to say:
  - "Overlap: “<title>” is in progress and expects to change some of the same files." (files icon);
  - what holds Start: the refusals and waits (lock icon);
  - "Start joins the queue: <waits>" (clock icon);
  - the Usage estimate line.
- A queued Task shows a **Queued** badge with "Place <n> · <reasons>" in the notes instead.
- Ready's Needs you words: "Ready: start it when you want; nothing starts by itself."

## Planning actions

- **Plan with <Planner>** (map icon): on a Backlog Task; opens a planning Thread for the user to talk it through first; none while nobody holds Plans.
- **Make a plan**: in Backlog, in the Planner's conversation tab, with the **Auto mode** switch; the Planner plans from the title and the Description at once.
- The switch starts at the remembered default; the choice made with Make a plan becomes the default.
- On a board card the Backlog Task's Plan is an icon button "Plan", in the remembered auto mode its tooltip names ([work-board.md](work-board.md)).
- A Task planning in auto mode says so above the Planner's Thread: "Planning with <Planner>, in auto mode: once the plan is written, the Task is marked Ready without your Confirm."
- **Mark Ready** (check icon, primary): offered in Planning and in Backlog once a Pipeline is chosen and no Decision is open; disabled in Planning until then.
- With the Plan or the Definition of Done not confirmed, Mark Ready first asks in a small window "Mark <title> Ready?": it names what isn't written or confirmed, says "Marking it Ready confirms the Plan and the Definition of Done as they stand.", and its button is **Mark Ready anyway**.
- Rules: [2.1.5](../2.1.5-planning-and-start.md), [2.1.3](../2.1.3-tasks.md#mark-ready).

## Run controls

- **Pause** and **Stop**: while the Task is In progress or Waiting on you.
- Pause hint: "Hold the Task once the Agent's current turn ends, keeping the Stage's edits"; toast "Pausing once the Agent's current turn ends."
- Stop hint: "Interrupt the Agent now and discard the Stage's uncommitted edits"; toast "Stopped: the Stage's uncommitted edits are discarded."
- **Resume** (play, primary): on a Paused Task; its label and hint say how the Task goes on (from the latest run, its Thread's context and whether a Decision is open); toast "Resumed."
- **Restart from…** and **Start over**: on a Paused Task, including one Stopped, the user's alone; while the fire alarm, a usage window or a paused Initiative holds the Task they are refused with the reason, as Pause and Stop are.
- Restart from… opens a window "Restart <title> from…" with a **Restart from** picker of every Stage of the Pipeline, later ones too, optional **Feedback**, and the button **Restart**; it says the held run ends and the Stage's uncommitted edits Pause kept are discarded; toast "Restarted from <Stage>."
- Start over opens "Start <title> over?" with the checkbox **Reset the branch to <base>**, checked, <base> being the Initiative's branch for an Initiative Task, else the Project's base branch; it says the Task goes to Ready, keeps its Plan, Definition of Done and Pipeline, and keeps its earlier Stage runs as history; the button **Start over**; toast "Started over: the Task is Ready."
- A Task whose Publish pushed its branch or opened a pull request refuses Start over: "Its work has left the workstation: use Restart from… instead."
- Rules: [2.4.5](../2.4.5-stopping-and-restarts.md#stop-and-pause), [Restart from](../2.4.5-stopping-and-restarts.md#restart-from), [Start over](../2.4.5-stopping-and-restarts.md#start-over).

## Reopen window

- "Reopen <title>?" (Small), button **Reopen the Task**, from the head or **More** on a Dropped Task.
- Radios **To Backlog** and **To Ready**; To Ready is disabled with the reason unless the Plan, Definition of Done and Pipeline are confirmed.
- For a Task that had started: the checkbox **Reset the branch to <base>**, checked, and the words that its earlier Stage runs stay as history; refused once Publish pushed: "Its work has left the workstation."
- It notes a closed GitHub issue is reopened, and that the Decisions the Drop closed stay closed.
- A refusal shows in the window ("The Task can't be reopened", with the reason); success toasts "Reopened to <Backlog|Ready>."
- Rules: [2.1.3](../2.1.3-tasks.md#reopen).

## Pipeline rail

- A section named "Pipeline · <name>" across the page, with the caption "<progress> · select a Stage for its history".
- Caption words: "Not started"; "At <Stage>: <state>"; "<n> of <m> Stages finished"; "All <n> Stages finished" once Done; in Planning "Starts once you confirm the Plan, the Definition of Done and the Pipeline".
- **Edit for this Task** (ghost button in its header): until the Task ends, never in Shaping.
- Until the Task has its own copy the rail shows the library Pipeline's Stages.
- Each Stage is a column with: its mark, its name (a button that opens the Stage history), its worker, its state words, its runs and tokens.
- Mark: the Stage kind by shape, its state by colour and icon (done check, failed x, waiting or paused pause, stopped square, skipped minus, not taken skip-forward); a running Stage's line is live.
- Worker: the Role's person, "You" at a Gate, the command for a Script Stage, or "<label> · nobody holds it" for a duty nobody holds.
- State words: Pending, Running, Waiting on you, Paused, Stopped, Done, Skipped, Not taken, Failed, with "· went back to <Stage>" when a route back sent the work back; "Waiting for a run environment" for a Script Stage whose command hasn't started.
- Runs words: "Not started", "Not run yet", "Not needed" (skipped), "Not run" (not taken), else the count and time ("so far" while running).
- Routes back the walk followed: an arc over the Stages from the Stage to where the route sent the work back, marked "<n> of at most <limit>" ("<n> times" for a route with No limit); the mark selects the Stage the route leaves; its words say "<Stage> went back to <Stage> <n> times, of at most <limit>".
- When the Stages don't fit (150px a Stage at least) the rail scrolls sideways and keeps the current Stage in view.
- A Task whose Pipeline was removed from the library shows "Its Pipeline was removed from the library."
- A Publishing Task that waits shows "Waits for “<blocker>” before its next Stage." ([initiative-page.md](initiative-page.md#pipelines-block)).
- Rules: [2.3.1](../2.3.1-stages.md), [2.3.2](../2.3.2-flows.md).

## Pipeline not chosen

- A Task with no Pipeline shows a dashed rail "Pipeline · Not chosen yet" with no Stages, and the proposal when there is one.
- In Backlog the rail has **Choose a Pipeline** (primary, centred on the rail), which opens "Choose a Pipeline for <Task>" (see Edit for this Task).

## Pipeline proposal

- At the rail's foot, a row that wraps: the badge "Proposed by <Planner>", the Pipeline's name ("(the one it follows)" when it is the current one) and the reason.
- **Use <name>**, or **Confirm** when it is the current one; **Keep <current>** (none for a Task with no Pipeline); and an **Another Pipeline…** picker for the rest.
- A proposed Pipeline that can't be chosen can't be taken: Use or Confirm is disabled with why, and an alert "<name> can't be taken" says why.
- A refusal shows as "The Pipeline wasn't set".
- Each choice ends the proposal.

## Broken Pipeline flag

- A Task that hasn't started, on a Project Pipeline that was Broken before The Office updated and isn't saved since, with no Stages edited for it, can't start ([2.3.5](../2.3.5-library.md#the-move-to-routes-back-and-publish-stages)).
- At the rail's foot, before the proposal, a warning "<name> was Broken before The Office updated" with why, "The Task can't start until it is saved in <Project>'s Pipelines, or another Pipeline is chosen for it.", and **Choose another Pipeline**, which opens Edit for this Task.
- Rules: [2.3.5](../2.3.5-library.md).

## Edit for this Task

- Window "Stages of <Task>" (one height, large); for a Task with no Pipeline "Choose a Pipeline for <Task>".
- It edits the Task's own copy of the Stages and the Pipeline swap before Start, both a draft until **Save for this Task**.
- Each Stage with a run is locked, with its state's words.
- Script Stages are offered the Project's commands, never Publish; a Publish Stage is a kind of its own in Add a Stage ([pipeline-flow-editor.md](pipeline-flow-editor.md#stage-templates)).
- A swap or an edit naming a command the Project lacks is refused by the service, shown as an alert.
- With no Pipeline chosen yet, the picker opens on the default for the Task's Kind, its Stages shown, so one press of Save chooses it; it is listed first and badged "Default for Features", "Default for Bugs" or "Default for Chores" ("Project default" when the Kind has none of its own, [2.1.1](../2.1.1-projects.md#project-settings)), then the Project's own Pipelines and the office-wide ones; one that can't be chosen (a Project Pipeline the move left from a Broken one, not saved since, [2.3.5](../2.3.5-library.md#the-move-to-routes-back-and-publish-stages)) is listed with why and never chosen, and with none to open on Save is disabled with "Choose a Pipeline first."; Save sets the Pipeline, then saves the Stages if edited.

## Stage history

- A large window opened by pressing a Stage on the rail, or a route back's mark.
- Title: "Stage history: <Stage>", the worker, a badge with the state, and the hint "← → Stages".
- Under the title: the Pipeline in small to move between Stages, then a line saying what the Stage is for and who works it.
- Left: the runs, newest first, as buttons "Run <n>" with an outcome badge, a "Briefed with what failed" mark when it carried a failure, then time, tokens, the engine ("Stand-in for <engine>" when it ran on a Stand-in Engine) and a gist.
- Right: the run picked; it stays picked while the window is open.
- An ended run names the route it followed, with its count: "Went on to Review", "Went back to Implement (2 of at most 3)", or "Went to End".
- An Agent's choice shows with its reason: "Chose Review: the change touches what the user sees"; a Publish Stage's result with what shipped: "Published: pull request #212 opened", "Conflict with main in 3 files".
- A Stage Skipped by a restart shows Skipped, with "Not needed" on the rail.
- A run the user's Restart from… held reads "Restarted from <Stage> by <user>" with its feedback, and the run the restart ran shows the feedback as well; a Script Stage keeps it on its run.
- A Start over shows "Started over by <user>" (with "Branch reset to <base>, old head kept as <ref>" when it reset) and a divider "Earlier start" before the runs of an earlier start, which are history only ([2.4.5](../2.4.5-stopping-and-restarts.md#start-over)).
- A Stage with no runs says "Runs once the Task starts." (not started) or "Hasn't run yet."
- ← and → move to the previous or next Stage, heard on the document, unless a field is typed in or an Attachment viewer is over the window.
- Closing returns focus to the Stage on the rail.
- Open state: kept in the page, not the address, unless `taskThread` names a run id (as a Decision's "in Implement, run 6" does) or a Stage's Thread with no `decision`, which opens at the latest run and clears from the address as it closes.
- A link leading elsewhere, or the way to a Decision's card, closes it.
- The Initiative page opens the same window for a Publishing Task's Stage ([initiative-page.md](initiative-page.md#pipelines-block)).

## Run details

- The head names the model and the engine the session ran on, with a "Stand-in for <engine>" badge whose hover says why.
- A run opens on **Summary** (ended) or **Thread** (running); a third tab **Sub-agents and processes** with its count shows only for a run whose Thread had any.
- The Summary says each move to a Stand-in Engine on a line of its own, such as "Claude Code's 5-hour window was used up until 14:00, so the Stage went on on Claude Code 2".
- A run held by a used-up window whose context is over Settings › Engines' ask-above size says it waits for the user's choice of the Stand-in Engine or the reset.
- A Handover note in the Thread shows its first lines and "Read it in full", which opens the Summary of the run that kept it, in whichever Stage.
- A Project command's run shows its outcome and each command's line, result, duration and output (the last 64 KB).
- An ended Stage's Thread keeps the run's last context reading in the row above it ("Ended at 132k of 200k"; [2.5](../2.5-context-policy.md)).
- A Gate's run links to Needs you and shows its Attachments of every kind.
- The Thread follows live (it leaves a reader who scrolled up be), has a **Details** switch, and while the Stage runs takes a message at the next safe point; the draft is kept as the tab or run changes; a closed Thread says why.
- The Thread view: [thread.md](thread.md).
- Rules: [2.9.3](../2.9.3-streaming-and-ui.md), [5.4.6](../5.4.6-stand-in-engines-and-usage-windows.md).

## Needs you card

- First in the record column, a section "Needs you" with a count badge, a summary ("<n> Decisions · a Gate · a Stand-in Engine choice · <n> waiting on a Consultant") and the items.
- Items: the Task's unanswered Decisions, the Gate it waits at, and, while the Task is Paused by a used-up usage window and a Stage waits for the user's choice, The Office's Stand-in choice for this Task.
- Decisions are answered in place with the Decision card ([decision-card.md](decision-card.md)); each has a place link "in <Stage>, run <n> · <time>" to the Stage history, "in <Person>'s Thread · <time>" (opens the conversation), or "in the Initiative's planning Thread · <time>" (to the Initiative page's Thread, `?initiativeThread=`).
- Decisions the Planner opened in the Initiative's planning Thread show here too, answerable while the Planner works.
- A Decision with a Consultant is shown and not counted.
- The count is the Decisions waiting on the user, plus the Gate, plus the Stand-in choice.
- A `?decision=` link lands on its card; only this card carries the element id.
- While the card is out of view, a slim bar "Needs you" with the count, the first question and **Show** takes its place, sticky at both edges of the record column.
- With nothing waiting the card says where the Task stands: "Nothing needs you right now. You'll see it here first."; "Nothing needs you: this Task is Done."; "This Task was dropped."; Ready's line (see Start and the queue) with the Usage estimate unless queued; in Shaping "Waiting for its Initiative to be confirmed: it can't be planned or started until then." with a link to the Initiative.
- A Dropped Task's card says it was dropped over anything left open.
- Rules: [2.4.2](../2.4.2-decisions.md), [2.4.3](../2.4.3-consultations.md).

## Before Ready

- Shown under any Decision on the Needs you card, in Planning, and in Backlog once the Plan or the Definition of Done is written.
- A read-only checklist (list-checks icon, title **Before Ready**): one line per condition, a check when met.
- Each unmet line says where it is settled and links there:
  - Plan: "Write it" or "Confirm it" "on the Plan" (shows Overview, opens the block and scrolls to it);
  - Definition of Done: the same, "on the Definition of Done";
  - Pipeline: "<Planner> proposes <name> · confirm it on the rail", "Choose a Pipeline on the rail", ending ": <name> is the default for <Bugs|Features|Chores>" when the Task's Kind has a default of its own (Backlog), "<Planner> proposes one while planning", or, for a current or proposed Pipeline that can't be chosen, "<name>, which was Broken before The Office updated · choose another on the rail" ("<Planner> proposes <name>, which …" when proposed; [Broken Pipeline flag](#broken-pipeline-flag));
  - Decisions: "<n> open, in Needs you".

## Gate

- A waiting Gate shows in Needs you as the Gate card ("Gate · <name>"): what it waits for, a line of its facts (files changed, tests, Definition of Done) and the buttons **Continue** (or **Continue and publish anyway** while Definition of Done statements are unmet) and **Show details**.
- Show details opens the large Gate window: the four facts (Files changed, Lines, Tests, Definition of Done), unmet statements, the Attachments of this round, and in the bar **Continue**, **Open Changes**, **Continue with notes…** (when an Agent Stage follows), **Send back with notes…** (when targets exist) and **Drop**.
- Continue with notes and Send back (fields "Send back to", "Your feedback") and Drop's confirmation, which holds the same Reason as the Drop window (see Task menu), are steps over the window; their buttons stay disabled until the notes are written ("Write your notes first", "Write your feedback first").
- A refusal shows as "The Task didn't continue" or "The work wasn't sent back".
- An Attachment shows on the Gate when no earlier Gate run of the Task showed it.
- Open Changes closes the window and shows the Changes tab.
- Rules: [2.3.3](../2.3.3-gates-and-checks.md).

## Record tabs

- Tabs **Overview**, **Changes** (count of changed files), **Attachments** (count), **Engine**; kept in the address as `recordTab`.

## Overview

- Blocks, top to bottom: **Description**, **Plan**, **Definition of Done**, **Commit message**, **Devices**, **History**.
- Each is a fold remembered per Task in this browser; a folded body stays mounted, so an editor keeps what was typed, and **Edit** opens the fold first.
- Open at the start: Description always; Plan and Definition of Done in Planning; Commit message and History folded.
- Each fold's header has an icon, title, a summary line while folded, and its actions.

### Description

- The user's words, in Markdown; summary: its first line (or "None"), plus a dependencies summary.
- **Edit** until Start: editor labelled "Description" with the hint "What you want, in your own words, in Markdown; type @ to mention a Task, Initiative, Decision or Idea. The title alone is enough to plan from."
- Empty: "None: the title is all there is."
- A refusal shows as "The Description wasn't saved".
- Sections below the text: Bug, GitHub issue, Dependencies, Caused bugs, Duplicates, Found while working on, Conflict resolution, Initiative, Origin.
- Rules: [2.1.3](../2.1.3-tasks.md#description).

### Bug

- Section "Bug" (bug glyph), only on a Bug; another Kind keeps its rows hidden ([2.1.3](../2.1.3-tasks.md#bug-details)).
- **Caused by**: the Task, linked with its Kind, Project and state badge, or "Not known"; **Add what caused it** opens "What caused it?", the Task picker of Dependencies' Add listing Done and archived Tasks too and never this one ("There is no other Task to pick."); a remove button "Remove what caused it"; a refusal shows as "It can't be what caused it".
- **Found in version**: the version or "Not known"; **Add the version** or **Change** opens a searchable select of the Project's `v*` tags, newest first, and takes typed words as free text up to 64 characters (placeholder "A release tag, or your own words", or "The version, in words" with no tags); a remove button "Remove the version"; a refusal shows as "The version wasn't saved".
- Until Done or Dropped it is editable; then read-only, its empty rows hidden.

### GitHub issue

- Section "GitHub issue" (github icon), only on a Task made from an issue ([2.1.1](../2.1.1-projects.md#github-issues)).
- One line: the issue's state icon (open or closed), "#<n> <title>" linking to GitHub, "opened by <login>" linking to its author, "· imported by <user, or The Office>, <when>".
- Closed on GitHub, while the Task hasn't started: an info alert "Closed on GitHub, <when>" with "The issue was closed before this Task started. Nothing changes here: check whether the Task is still needed, or drop it."; once it has started, a muted line "Closed on GitHub, <when>".
- A write-back GitHub refused shows its problem in a muted line until it succeeds or stops being tried.

### Dependencies

- Section "Dependencies": "Must be Done first" (the blockers, each a link with its Project, title and state badge) and "Waiting for this Task".
- Before the Task starts: **Add** and a remove button "Stop waiting for <title>" per blocker; once started the section shows only with something to show.
- Empty: "It waits for no Task, and none waits for it."
- **Add** opens "What must be Done first?": a "Find a Task" search ("Find a Task by its title"), radios of candidates (archived Tasks left out), button **Add**; no candidates: "No other Task can hold it back: the rest are Done, Dropped, or already wait for it."; no match: "No Task's title has “<search>”."
- A refusal shows as "It can't wait for that Task".
- Rules: [2.1.3](../2.1.3-tasks.md#dependencies).

### Caused bugs and Duplicates

- Section "Caused bugs": the Bugs whose Caused by names this Task, each linked with its state.
- Section "Duplicates": the Tasks dropped as duplicates of this one.
- Each shows only with something to show.

### Found while working on

- Section "Found while working on", on a Task of any Kind that has one: the Task it was found while working on, linked with its Kind, Project and state badge; never changed, so never editable ([2.1.3](../2.1.3-tasks.md#found-while-working-on)).
- A Task with none shows no section.

### Conflict resolution

- Section "Conflict resolution", on a Task that has Conflict resolution Tasks: "Conflicts resolved by: <Task (state)>".
- On a Conflict resolution Task: "Resolves the conflicts of: <Task (state)>".
- The Task is made from Work › Pull requests' **Resolve conflicts** ([pull-requests.md](pull-requests.md)).

### Initiative

- Section "Initiative": the Initiative the Task is in, linked, with its state badge and **Take out**; or, for a Task in none, "In no Initiative. Add it to one being shaped or active, before it starts." with **Add to an Initiative**.
- Both only before the Task starts and never for a Task The Office made; once it can't change, only the Initiative it is in shows.
- Add to an Initiative: window of the same name, a searchable "Initiative" select ("Find an Initiative", "No Initiative matches") of Shaping (Task in Backlog only) or active ones; a hint says what joining does to its state; button **Add to the Initiative**; toast "<title> is in <Initiative> now."
- Take out: "Take <title> out of <Initiative>?" with a danger button **Take out**; it says what happens to its state ("It goes to Backlog.", "It stays in <state>.", planned-in-Initiative cases) and "What it waits for stays."; toast "<title> is out of <Initiative>, in <state>."
- Rules: [2.1.3](../2.1.3-tasks.md#joining-and-leaving-an-initiative).

### Origin

- Section "Origin": the Idea it was shaped from (linked to Work › Ideas, with its Project chip and "captured <day and time>", then its notes), and one line per Project move "Moved from <A> to <B> · <time>".
- Absent when there is neither.

### Plan

- Markdown text, then "Files to change" (paths in `code`), then "The Planner expects the whole Pipeline to use about <n> tokens." when it has an estimate.
- Header: **Confirmed** or **Not confirmed** with **Confirm** (Backlog and Planning only), and **Edit** (Backlog, Planning, Ready; never Shaping).
- Summary: "No Plan yet", or its first line with "· <n> files".
- Editor: "Plan" ("How the Task will be implemented, in Markdown.") and "Files to change" ("One path per line, from the repository's root; a folder covers the files under it."), **Save**, **Cancel**.
- Saving a change leaves it unconfirmed.
- While the Task is Ready, a line beside Save says: "Saving a change moves this Task back to Planning, to confirm and mark Ready again." (Backlog for one never planned; "takes this Task out of the queue and moves it" while queued).
- Empty: "No Plan yet." with "Make a plan with <Planner> from the conversation, or write it yourself." (Backlog), "<Planner> proposes it while planning, or write it yourself." or, in Shaping, "It is written once the Initiative is confirmed."
- Refusals: "The Plan wasn't saved", "The Plan wasn't confirmed".
- Rules: [2.1.5](../2.1.5-planning-and-start.md#plan-and-definition-of-done).

### Commit message

- The message of the one commit Publish lands the Task as, in monospace.
- Summary: its subject; "Default · <subject>" while none is written; "Published · <subject>".
- **Edit** until Publish lands it or the Task is Done or Dropped; hint "The message of the one commit Publish lands the Task as: a subject line, a blank line, then the body. Leave it empty for the default."
- None written: "None written: Publish uses the Task's title with a short summary below it."
- Once landed: "Published as one commit."
- Refusal: "The commit message wasn't saved".
- Rules: [2.1.3](../2.1.3-tasks.md#commit-message), [2.3.4](../2.3.4-publish.md).

### Definition of Done

- A list of statements, one per line in its editor ("One statement per line: what must be true when the Task is done.").
- Before Start: **Confirmed** / **Not confirmed** with **Confirm**, and **Edit**; summary "<n> statements · not confirmed yet".
- From Start on: the badge and summary "<n> of <m> Reported met", read from the Task's Stages, never worked out here.
- Empty: "Not written yet." with "<Planner> proposes it while planning, or write it yourself; a Task can't be Ready without one."
- Refusals: "The Definition of Done wasn't saved", "The Definition of Done wasn't confirmed".

### Devices

- The Devices section (plug icon), shown only while the Project's Run environment is On and its Connected devices are switched on ([Feature switches](../2.1.1-projects.md#feature-switches)); open at the start while the Task has a device not Disconnected.
- Summary: "<n> connected", or "None connected".
- A list, one row per device not Disconnected: its name, a badge for its kind (**Android phone over USB**, **Serial board over USB**, **Android phone over wireless debugging**), its state (**Connecting**, **Connected**, **Waiting for the run environment**), "connected by <user> · <when>" (<user> reads "you" for yourself), its endpoint in monospace once Connected (`127.0.0.1:<port>` for an Android phone over USB, the serial path such as `/dev/ttyACM0` for a serial board, then " · " and its RFC 2217 address such as `rfc2217://127.0.0.1:2217`), for a serial board "<baud> baud · round trip <n> ms" once each is known, and **Disconnect**.
- An Android phone over USB's endpoint reads "adb serial 127.0.0.1:<port>", as `adb devices` lists it.
- An Android phone over wireless debugging's name is its IP address until adb connects, then its model; its endpoint reads "adb serial <address>:<port>".
- While a phone waits for the user to let adb in, its row says "Allow USB debugging on the phone, and tick Always allow from this computer."; the line goes once the phone lets adb in.
- Below it, a fold "Disconnected" lists the Task's earlier devices with why and "disconnected <when>", each as [2.13](../2.13-connected-devices.md#states) names it.
- **Connect a device** is a menu: the USB kinds this build has a way to reach in the browser, each opening the browser's own device picker (an Android phone with WebUSB, a serial board with Web Serial), then a divider and **Pair over wireless debugging**.
  - Its USB choices: **Android phone over USB** (WebUSB) and **Serial board over USB** (Web Serial) in this build.
  - A choice this browser can't reach is greyed, with why under its name: "Needs Chrome or Edge" (no WebUSB, or no Web Serial), or "Needs The Office over HTTPS or localhost" (the page isn't a secure one).
  - While the phone picker is open, and after it closed with no phone picked, the section says "Don't see the phone? Turn on USB debugging in Developer options."
  - A serial board the browser can't open shows "This board is open in another tab or program."
  - The note "Keep this tab open: closing it disconnects the device."
- **Pair over wireless debugging** is never greyed: it works in every browser.
  - It opens the window **Pair over wireless debugging**, with the fields, each with its hint:
    - **IP address** (placeholder "192.168.1.20"; hint "From the phone's Wireless debugging screen, under IP address & Port.");
    - **Port** ("The number after the colon on the same screen.");
    - **Pairing port** ("From Wireless debugging › Pair device with pairing code: the number after the colon there.");
    - **Pairing code** ("From the phone's Wireless debugging › Pair device with pairing code. Used once, never kept.").
  - The note "Pairing starts the Task's run environment.", and the button **Pair**.
  - Each field is checked before sending, its words under it: "Enter the phone's IP address.", "Enter an IPv4 or IPv6 address, such as 192.168.1.20.", "Enter the port.", "A port is a number from 1 to 65535.", "Enter the pairing code.", "The pairing code is 6 digits."
  - **Pair** empties the Pairing code field as it sends, since a code works once.
  - Once the record is made the window closes with the toast "Pairing with the phone at <address>…"; its row shows Connecting while adb pairs, then Connected, or it moves to the Disconnected fold as error with adb's words.
  - A refusal shows in the window as the service words it (**The device wasn't connected**), the phone named "The phone at <address>": among them an address the run environment can't reach (loopback, unspecified, multicast, link-local, [6](../6-permissions-and-safety.md#connected-devices)), and a phone this Task holds already, Waiting, which is Disconnected before it is paired again.
- **Use a Project device**, beside Connect a device, is a menu of the Project's devices ([project-page.md](project-page.md#devices)), each with its name, its kind badge and its state at rest:
  - a device at rest is a choice; picking one connects it to this Task's run environment with no pairing ([2.13](../2.13-connected-devices.md#lent-to-a-task)), with the toast "<name> connected.";
  - a device in use elsewhere is listed disabled, naming its holder: "In use by <the Task's title | the Action run or test instance>";
  - a device over USB opens without the browser's picker when this browser allowed it before, else the picker opens; its choice is greyed in a browser without WebUSB or Web Serial, as Connect a device's are, and the note "Keep this tab open: closing it disconnects the device." applies;
  - a device picked there that isn't it is let go of and refused, under the section: "<name> isn't plugged into this computer, or the browser can't open it.";
  - with no Project devices: "<Project> has no devices yet." with a link "Add one under Devices".
- A lent device's row says "From <Project>'s devices", the Project's Devices section linked; its **Disconnect** gives it back to the Project, at rest again, with the toast "<name> given back to <Project>'s devices."
- A phone over wireless debugging that didn't answer at a run environment's start shows in the Disconnected fold as "device unplugged: The phone didn't answer at <address>:<port>; pair it again."
- An Android phone over USB whose run environment has no adb ends Disconnected as error; its why in the Disconnected fold reads "error: adb isn't in this Project's run environment. Add Android's platform-tools to .devcontainer, then try again.", with no warning above the list and no link.
- A serial board's notices ([2.13](../2.13-connected-devices.md#notices)) show on its row, one line each, in the warning tone unless said:
  - slow round trip: "Uploads will be slow: each step waits <n> ms for the round trip.";
  - no answer after a reset: "The board didn't answer after its reset; its bootloader may not wait for the <n> ms round trip. Press its reset button as the upload starts.";
  - 1200-baud touch: "This board resets into a new USB device to upload (1200-baud touch, as Leonardo and Micro do); that isn't carried through the browser.";
  - esptool's sync unanswered: "Use --port rfc2217://127.0.0.1:<port> for esptool's automatic reset, or hold BOOT, tap reset and upload with --before no_reset.", with the board's own RFC 2217 address; without one, "esptool's automatic reset isn't carried on this port. Hold BOOT, tap reset, and upload with --before no_reset.";
  - board busy: "The board is busy: one tool at a time can have it open, at <path> or at <rfc2217 address>. Close the other one first.";
  - no upload tool, in the info tone: "Neither avrdude nor arduino-cli is in the run environment's image; add the Project's upload tool to .devcontainer."
  - Before the round trip is measured, the words leave out "<n> ms".
- A device already connected to another Task is refused with "<device> is connected to <Task>. Disconnect it there first.", the Task linked.
- Toasts "<name> connected.", "<name> disconnected."; a refusal shows under the section as the service words it (**The device wasn't connected**).
- The browser's own refusals of an Android phone show the same way:
  - interface claimed elsewhere: "The phone is in use by adb on this computer (Android Studio or adb). Run adb kill-server, then connect again.";
  - no serial number: "The phone reports no serial number, so The Office can't tell it from another phone.";
  - no ADB interface: "The phone doesn't offer USB debugging. Turn on USB debugging in Developer options, then connect again.";
  - the system denied access: "This computer didn't let the browser open the phone.", then on Linux a udev rule for the phone's vendor id (`SUBSYSTEM=="usb", ATTR{idVendor}=="<vid>", MODE="0660", GROUP="plugdev"` in `/etc/udev/rules.d/51-android.rules`, in the plugdev group), on Windows the WinUSB driver (the Google USB Driver, or the phone maker's), both elsewhere, and "Then unplug the phone and connect again."
- Rules: [2.13](../2.13-connected-devices.md).

### History

- A fold "History" (history icon), last, starting folded.
- Summary: "Nothing yet", or "<n> changes · last <when>".
- One row per entry, oldest first: "Created in Backlog by …", "Moved from Ready to Planning by …", "Title edited by …", "Reopened to Ready by …", "Started over by …", each with its day and clock.
- Who reads as [2.1.3 History](../2.1.3-tasks.md#history) names them: "the user Ann Lee", "the person in the Role planner".
- Empty: "Nothing has changed yet."; a failed read shows a danger alert "The History wasn't read" with the service's message.
- Rules: [2.1.3](../2.1.3-tasks.md#history).

## Changes tab

- A block "Files changed · <n>", read as it opens and after each Stage.
- Buttons **Unfold all**, **Fold all** and **Open in editor** (while the Task has its worktree).
- **Open in editor** opens the worktree in VS Code through a `vscode://file/<worktree path>` link; each file's editor link is the same with the file's path. The Office launches no editor itself.
- Each file is a row folded to its header (path, "<old> → <new>" for a rename, "· deleted", added and removed line counts or "binary") that unfolds its diff against the base branch; a link opens it in the editor.
- A diff cut short says "The diff stops here: the rest is too long to show." (a file after the cut: "The diff stops before this file: the rest is too long to show.").
- "Tests:" with a badge per test result, or "not run".
- Empty: "No changes yet."; unreadable: "The changes can't be read: <reason>".
- After the Task's branch is deleted, it still shows what the Task changed, read from the tip The Office kept ([5.5](../5.5-git-and-isolation.md#what-a-deletion-does)).

## Attachments tab

- Block "Attachments" with **Add**; the shell's gallery shows a Task's by round from its Stages ([2.1.2](../2.1.2-ideas-and-attachments.md)).

## Engine tab

- A fold "Engine" (cpu icon), starting open.
- Summary: the engine it runs on and where it comes from: "<engine> · set for this Task · no stand-ins", "<engine> · from its Initiative · no stand-ins", "<engine> · from the Project" or "<engine> · from the Office default".
- A switch **Override the engine**; off, a line names the engine the Task follows ("Runs on <engine>, from the Project, with the Project's Stand-in Engines." or "… from its Initiative, with no stand-ins."); while its Initiative has an override, the switch's hint reads "Turn it on to run this Task on another engine than its Initiative's."
- On, an **Engine** select over the listed engines, grouped by engine type with each type's icon, starting on the engine it followed; no model: each person works with their own model and effort for its type.
- Under it, an info note: "No stand-ins: when <engine>'s usage window is used up, the Task waits for the reset."
- Each change saves at once with a toast ("<title> runs on <engine>, with no stand-ins." / "<title> follows its <Initiative's or Project's> engine again."); a refusal shows under the field, headed "The engine wasn't saved".
- Read-only once the Task is Done or Dropped, with "Kept as it was: the engine of a Done or Dropped Task doesn't change."
- While a Stage runs, a note says that session finishes on the engine it started on and a change applies from each next session, which starts fresh on a new engine.
- A "Runs on" list names the Planner and each Role its Stages name, with the model and effort each works with on the Task's engine and where each came from: "<model> · <effort>", then "from <person>'s Role card", "from the Project's setting for <person>", "forced by the Project" or "the engine's default"; a Stage that sets its own effort adds "<effort> on <Stage>".
- Rules: [2.1.3](../2.1.3-tasks.md#a-tasks-engine), [5.4.5](../5.4.5-engines-and-cascade.md#the-engine-cascade), [5.4.6](../5.4.6-stand-in-engines-and-usage-windows.md#a-forced-engine-has-no-stand-ins).

## Conversation

- A tab per person, from the Task's conversation: the Planner first, then whoever worked a Stage, then a Consultant; each holds that person's one Thread on the Task with its composer.
- A tab shows a live dot while that person's Stage runs and a count of messages that landed while out of view.
- The head of the panel: the person's name and title, a line of what they did ("Plans this Task", "Hasn't planned this Task", "Worked on <Stages>", "In a Consultation on this Task", "Answered a Consultation on this Task"), and the **Details** switch.
- The first tab is chosen once; only the address moves it; pressing a tab writes the Role key to `taskThread`.
- `taskThread` names a tab by Role key or any of its Threads.
- While a person's Stage runs, a banner "<Person> is working on <Stage> now. To write into that work, open its Stage history." with **Open the Stage history**.
- Stage Threads are read in the Stage history; an ended run's foot has "Ask <name> about it".
- A tab with no Thread has a composer ("Ask <name> anything about this Task…") and the first message opens the Thread; looking at a tab opens nothing; a draft is kept per Task and person; the context label shows what the Thread would start on.
- In Backlog the Planner's tab has **Make a plan** and the line "Or Plan with <Planner> in the head, to talk it through first."; no composer.
- Empty tab words: "No conversation yet. Ask <name> anything about this Task." (Planner), "No messages yet. Ask <name> anything about this Task: <name> worked on <Stages>."
- A Consultant's Consultations sit above the Thread: "Consultation · <name> is on it" (live, read-only, the user can't join it) or "Consultation · <time>" with the answer in words.
- The Planner's tab while the Task is planned in its Initiative's planning Thread says so, links **Open the planning Thread**, and has no composer.
- In Shaping an empty tab says "Waiting for its Initiative to be confirmed: …" with a link.
- A Done or Dropped Task's tabs are read-only with the reason.
- The "new messages" button works on the shown tab only and never moves a reader who scrolled up.
- The To line, composer and context bar are the shared Thread view's ([thread.md](thread.md)).
- Rules: [2.4.1](../2.4.1-threads.md#a-persons-thread-on-a-task), [2.4.3](../2.4.3-consultations.md).

## Conversation drawer

- At 900px and below, the conversation is a drawer opened by the round **Conversation** button (message icon, with the unread count).
- The panel is always mounted, so a draft, folds and the unread count survive closing.
- **Close the conversation**, Esc and a press outside shut it.
- A link to a Thread opens it; the way to an open Decision's card closes it.
- Opening it closes the Needs you panel and the Activity panel, and leaves the chat drawer open under it; opening any of the three closes it ([4 Side panels](../4-ux-direction.md#side-panels)).

## States

- Loading: only the tab strip shows until the Task and the Pipelines are read.
- Missing: an empty state "Back to Work" with the service's message when the Task is gone (404), or "The Task can't be shown." with its reason.
- Shaping: Plan, Definition of Done and Pipeline are read-only; the Needs you card and every conversation tab say what they wait for.
- Archived: the head shows **Archived <day>** and **Restore**.
- Done and Dropped: no Edit, Edit Stages or Move; Drop is gone; **Archive** is in the menu.
- Narrow window (900px and below): the conversation is a drawer.
- Pause and Stop appear only while running; Resume only while Paused.

## Domain facts

- [Task states](../2.1.3-tasks.md#task-states), [Ready](../2.1.3-tasks.md#ready), [Mark Ready](../2.1.3-tasks.md#mark-ready)
- [Plan and Definition of Done](../2.1.5-planning-and-start.md), [Auto mode](../2.1.5-planning-and-start.md#auto-mode)
- [Stages](../2.3.1-stages.md), [Gates](../2.3.3-gates-and-checks.md), [Publish](../2.3.4-publish.md)
- [Decisions](../2.4.2-decisions.md), [Consultations](../2.4.3-consultations.md), [Threads](../2.4.1-threads.md)
- [Stop and Pause](../2.4.5-stopping-and-restarts.md#stop-and-pause)
- [A worktree per Task](../5.5-git-and-isolation.md#a-worktree-per-task), [Deleting merged branches](../5.5-git-and-isolation.md#deleting-merged-branches)
- [Connected devices](../2.13-connected-devices.md)
- Related screens: [work-board.md](work-board.md), [initiative-page.md](initiative-page.md), [thread.md](thread.md), [decision-card.md](decision-card.md), [pull-requests.md](pull-requests.md)
