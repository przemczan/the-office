# Initiative page

Covers: the Initiative page's head and actions (Confirm, Back to Shaping, Plan the Initiative, Plan with…, Start Ready Tasks, Pause, Resume, Add a Task, Drop, Archive), the Tasks block and its graph, membership (Add an existing Task, Take out), the Pipelines block and its editor, the Engine fold, the Test instances block (Launch, states, Open, Download and the QR code, Stop, Log), the record's folds (Outcome, Attachments, Origin, History), and the shaping and planning Threads.

## Where it is

- Route: `/work/initiatives/<id>`.
- Open it from an Initiative card on Work › Initiatives ([initiatives-tab.md](initiatives-tab.md)), a block or group head on the Work board ([work-board.md](work-board.md)), a Task page's Initiative section ([task-page.md](task-page.md#initiative)), or a Notification.
- The page title and crumb are the Initiative's name; the parent crumb is "Initiatives", leading to `/work/initiatives`.
- Search params: `initiativeThread` (a person's tab by Role key, or a Thread id), `decision` (lands on that Decision's card in a Thread).
- The Work tab strip shows at the top with Initiatives chosen ([work-board.md](work-board.md#tabs)).

## Layout

- The tab strip, then the head.
- Under the head, once Start Ready Tasks has run: its note.
- The Tasks block, across the page.
- Below it two columns: the record on the left, the conversation on the right.
- The record column holds, top to bottom: the shaping note (while shaping), Pipelines, Test instances (once active), Outcome, Attachments, Origin, History.
- At 900px and below the conversation is a drawer, as on the Task page ([task-page.md](task-page.md#conversation-drawer)).

## Head

- The name (`h2`).
- Badges: the state ("Shaping with <Shaper>" while someone shapes Initiatives, else "Shaping"; "Active"; "Done"; "Dropped"), **Paused** (pause icon) while paused, and **Archived <day>** once archived.
- The Project chips of its Tasks, or "No Project yet".
- "· <done> of <counted> Tasks done" with "· <n> ready to start" when Ready Tasks wait for no Task; a Dropped Task no longer counts; Publishing Tasks count.
- Once it has a planning Thread: "· <planned> of <n> Tasks planned" with "· <n> waiting for your answer" (see Task planning steps).
- Right: the head's actions and **More for <name>**.

## Head actions

- One line of buttons; whatever wraps past it is hidden, the last first, and **More** always holds every action as its first items.
- The line keeps room for its first button and **More**: when the title leaves less, the actions go under the title, never a blank where a hidden button was.
- In order: **Confirm the Initiative**, **Planning Thread**, **Plan the Initiative**, **Plan with <Planner>**, **Start Ready Tasks**, **Pause the Initiative** or **Resume the Initiative**, **Add a Task**, **Add an existing Task**, **Browse files**, **Back to Shaping**, **Restore**.
- Each is coloured by its tone, in the buttons and in **More** ([Action tones](../4.1-ui-rules.md#action-tones)).
- **Confirm the Initiative** (check, primary): while shaping; toast "Initiative confirmed. Its Tasks moved to Backlog, to wait until <Planner> plans them." or "Initiative confirmed, and done: its Tasks are."
- **Planning Thread**: a link to the Initiative's latest planning Thread (`?initiativeThread=`), once it has one.
- **Plan the Initiative** (map, primary) beside an **Auto mode** switch: offered while it is active with a Task in Backlog and someone holds Plans.
  - The switch starts at the remembered default; the choice made becomes it; from More it plans as the switch stands.
  - One planning Thread with the Planner, who plans its Backlog Tasks in their dependency order.
  - Toast: "<Planner> is planning the Initiative's Tasks in Backlog, in their dependency order, in auto mode: each is marked Ready once planned." or "… . You confirm each one as it is planned."
  - Disabled while the Initiative's latest planning Thread's person is answering there, with the hint "<Planner> is still planning in the planning Thread: write there, or wait until they finish."; **Planning Thread** stays the way in.
  - The service's other refusals show as a toast.
- **Plan with <Planner>** (message icon): same offer, disabled with the same hint while the latest planning Thread's person is answering; opens a new planning Thread where the Planner waits for the user's first message on how to plan; auto mode is off; toast "<Planner> waits for your message: say how to plan the Initiative's Tasks in Backlog. Auto mode is off: you confirm each one as it is planned."; the conversation then opens on that Thread.
- **Start Ready Tasks** (play): while it is active and a Task of it is Ready; the normal Start on each Ready Task, an Overlap queued behind; toast "<n> started, <n> queued, <n> refused"; a refusal of the whole action shows as a toast.
- **Back to Shaping** (undo icon): while it is active; opens the confirm window ([Back to Shaping](#back-to-shaping)).
- **Pause the Initiative** (pause): while it is active and not paused; holds its running Tasks once each Agent's current turn ends and starts none of its Tasks; hint "Hold its running Tasks once each Agent's current turn ends, and start none of its Tasks"; toast "Initiative paused: <n> Tasks paused. None of its Tasks starts until you resume it." (or "none of its Tasks was running").
- **Resume the Initiative** (play): while paused; hint "Resume the Tasks its Pause held and let its Tasks start again"; toast "Initiative resumed: <n> Tasks resumed.", or "… go on at the fire alarm's all clear." while the fire alarm is on, or "Initiative resumed: its Tasks may start again." when none were held.
- A refusal of Pause or Resume shows its reason as a toast.
- **Add a Task** (plus) and **Add an existing Task** (list-plus): while it is Shaping or active (see Membership).
- **Browse files**: a link to the Project's Files tab with `?branch=` the Initiative's branch, one per Project it spans where that branch is known on this workstation ("Browse files in <Project>" when it spans several); it never fetches.
- **Restore**: while archived; back on the board in Done or Dropped, as it was.
- Rules: [2.1.4](../2.1.4-initiatives.md), [2.1.5](../2.1.5-planning-and-start.md).

## Initiative menu

- **More for <name>** (ellipsis): the head's actions, then:
- **Copy link**.
- **Archive**: once Done or Dropped and not archived.
- **Drop the Initiative** (danger): while Shaping or active.

## Back to Shaping

- Window "Back to Shaping?", button **Back to Shaping**.
- It says how many Tasks move back to Shaping and from how many Projects the Initiative's branch is removed.
- Toast: "Initiative back in Shaping. Its Tasks wait in Shaping until you confirm it again."
- A refusal shows as "The Initiative can't go back to Shaping", with the reasons.
- Rules: [2.1.4](../2.1.4-initiatives.md#back-to-shaping).

## Drop the Initiative

- Window "Drop <name>?", button **Drop the Initiative**.
- It says how many of its Tasks not yet Done or Dropped it drops, and how many started: "It drops its 1 Task not yet Done or Dropped, which has started: its Stage stops." / "none of them started" / "<n> of them started: their Stages stop"; with none: "Its Tasks are all Done or Dropped already, so it drops none."
- Then "Its branches are kept. " (when it has branches) "It moves to Done as dropped and stays readable there; a dropped Initiative can't be picked up again."
- The counts are kept from the click on, as the Tasks' events land before the answer.
- A refusal shows as "The Initiative can't be dropped".
- Toast: "Initiative dropped, with its <n> open Tasks." or "Initiative dropped."

## Start Ready Tasks note

- An alert under the head, titled "Start Ready Tasks: <summary>" (warning while any was refused, else info), closable.
- Groups **Started**, **Queued** (each with "place <n>" and reasons) and **Refused** (with reasons); each Task is a link.
- It is page state for that Initiative alone: a reload or Close drops it.

## Tasks block

- A fold "Tasks" (git-fork icon), open by default, remembered per Initiative in this browser.
- Summary: "None yet"; "<n> across <m> Projects"; "· in Shaping until you confirm" while shaping; else with "· <n> done · <n> in progress · <n> waiting on you · <n> dropped", each only when a Task is in it.
- **Take out a Task** at its side while a Task of it hasn't started (see Membership).
- Empty: "No Tasks yet." with, while shaping and someone shapes, "<Shaper> drafts them with you in the conversation, straight onto this page."
- Publishing Tasks are left out of the graph and shown in the Pipelines block; progress counts them.

## Task graph

- A legend "What the arrows mean": "must be Done first", "its blocker is Done" (green), "from outside this Initiative" (dashed); each shown only when such an edge is drawn.
- The graph: columns by dependency depth, a Task standing right of every Task it waits for; across Projects.
- Arrows run from the blocker to the Task waiting for it, routed square from the measured boxes.
- The graph leaves room above and below its Tasks for every arrow routed around them, so none is cut off.
- Hovering or focusing a Task highlights its arrows: those from its blockers red, or green while that blocker is Done.
- The arrows from a highlighted Task to the Tasks waiting for it are blue.
- Every other arrow is dimmed while a Task is highlighted.
- Each node is a link to the Task page: Project mark, title, the state badge.
- A blocker outside the Initiative is drawn too, marked with "Initiative <name>" or "outside this Initiative", its edge dashed.
- Once the Initiative has a planning Thread, a node names its planning step: **Waiting**, **Planning**, **Waiting for your answer**, **Planned, waiting for your Confirm**, **Ready** (Planning and Ready are the state badge's own words).
- A Task with an open Decision shows "Waiting for your answer" before any other step.
- The page reads the Task list and the open Decisions; Task and Decision events refresh it.

## Membership

- **Add a Task**: the New Task dialog ([shell.md](shell.md)) given this Initiative, its Project (the one of the Idea it was shaped from, until it has Tasks) and the Tasks it can wait for.
- **Add an existing Task**: window "Add an existing Task to <name>", a "Find a Task" search ("Find a Task by its title"), radios of Tasks in no Initiative that can join (with Project and state), a hint saying what joining does to its state, button **Add the Task**; toast "<title> is in <name> now."
- Joining a Shaping Initiative: "It moves to Shaping, and to Backlog once the Initiative is confirmed."; joining an active one: "It stays in <state>."
- No candidates: "No Task can join: each is in an Initiative already, has started, or is one The Office made" (", or isn't in Backlog" while shaping).
- A refusal shows as "The Task can't be added".
- **Take out a Task**: window "Take a Task out" (radios) or, for one candidate, "Take <title> out of <name>?"; it says what happens to its state ("It goes to Backlog.", "It stays in <state>.") and "What it waits for stays."; button **Take out**; toast "<title> is out of <name>, in <state>."
- Only a Task that hasn't started can leave; a Task The Office made never can.
- Rules: [2.1.3](../2.1.3-tasks.md#joining-and-leaving-an-initiative), [2.1.4](../2.1.4-initiatives.md).

## Shaping note

- While shaping, an info alert in the record column.
- With a Shaper: "<Shaper> drafts the outcome and the Tasks with you in the conversation, straight onto this page. Once you confirm the Initiative, each change <Shaper> wants is a Proposal you apply."
- With none: "Write the outcome and add the Tasks, then confirm the Initiative to make it active."

## Pipelines block

- A fold "Pipelines" (route icon), the first block of the record.
- Open at the start unless it was confirmed with None in every Project; remembered per Initiative.
- Summary: Project by Project what each publishes through (while shaping "<Project>: <Pipeline> · …"); "None: each Task publishes on its own" (shaping) or "None: publishes Task by Task"; once active, where each Publishing Task is ("<Project> at <Stage>, waiting on you", "ready to start", "published", "has no Publishing Task yet"); "Published in <n> Projects"; "Done · no Publishing Task was needed"; "Dropped · <n> branches kept", "Dropped · branches deleted" once none is known here, or "Dropped · no Initiative's branch was made".
- With no Project on an Initiative's branch:
  - shaping: "**No Initiative's branch.** Each Task publishes into its Project's base branch on its own, as it is done. Press Edit to work on an Initiative's branch instead and publish the whole change at once, through a Pipeline."
  - confirmed: "None: publishes Task by Task." and "Each Task publishes on its own, as it is done. Whether its Projects have a Pipeline was fixed at Confirm."
- Facts: **Initiative's branch** with the branch in `code` (`initiative/<Short name>`), a note ("made at Confirm" while shaping) and, for several Projects, "in <A and B>"; once Done or Dropped, per Project, **Delete branch…** while the branch is known here (`GET /initiatives/:id/branches`, no fetch), opening the Task page's [Delete branch window](task-page.md#delete-branch-window), or "deleted" once it is gone; **Task by Task** with the Projects that publish each Task on its own.
- Then a block per Project with a Pipeline (a list "Projects"):
  - its head: Project mark and name, the Pipeline's name and its shape ("5 Stages, 1 Gate", "3 Stages, no Gate");
  - once active: its Publishing Task's link, state badge, how it published when Done ("Merged into <base>" or "By a pull request into <base>") and "Stages edited for this Task"; "No Publishing Task yet" before it is added;
  - a started Publishing Task's open blocker: "Waits for “<blocker>” before its next Stage."
  - while shaping, a Pipeline with no Gate shows a warning "Publishes without your review": "No Stage of <Pipeline> is a Gate, so the Initiative's branch in <Project> is published into <base> without you looking at it first."
- A track of the Pipeline's Stages: across, or stacked a Stage a row when each Stage can't get 96px of the track's width; the Task page's Stage marks and routes back (stacked: "<Stage> went back to <Stage>, <n> of at most <m>", or "…, <n> times" for a route with No limit).
- Each Stage of a Publishing Task's track opens that Task's Stage history on this page ([task-page.md](task-page.md#stage-history)); before a Publishing Task exists the track is a dashed placeholder from the Pipeline's Stages.
- Foot line: shaping "Once every other Task is Done or Dropped, each Project with a Pipeline gets a Publishing Task that walks its Stages."; active with none added "Once every other Task is Done or Dropped, The Office adds a Publishing Task in each Project with a Pipeline whose branch holds work, to publish its whole change; you start it, or Start Ready Tasks does. Another Pipeline for a Project comes by a Proposal of whoever shapes Initiatives."; then "A Project's Pipeline no longer changes once its Publishing Task has started." / "Their Publishing Tasks have started, so these Pipelines no longer change."; Dropped "Dropped: no Publishing Task is added any more."
- Each Project offers its own Project Pipelines too, grouped as a Task's picker groups them.
- Rules: [2.1.4](../2.1.4-initiatives.md), [5.5](../5.5-git-and-isolation.md#the-initiatives-branch), [2.3.4](../2.3.4-publish.md).

## Pipelines editor

- **Edit** in the block's header, while shaping and while active; Done and Dropped have none.
- Once active the editor shows only the Pipeline picker of each Project already on an Initiative's branch; the switch and the branch name show as fixed: "Fixed at Confirm: go Back to Shaping to change them"; a Project whose Publishing Task has started shows read-only with the reason.
- Once active, the Short name can't change; the change follows the rules of an applied Proposal ([2.1.4](../2.1.4-initiatives.md#an-initiatives-pipeline)).
- One form, three steps (a step is dimmed while it doesn't apply):
  1. **Work on an Initiative's branch?**: a switch per Project; on: "Works on `initiative/<name>`, published into <base> by its Publishing Task."; off: "Task by Task: each Task publishes into <base> as it is done." Hint: "On, the Initiative's Tasks start from its own branch and publish into it, and one Publishing Task puts the whole change into the base branch at the end. Off, each Task publishes on its own, as it is done. Fixed at Confirm."
  2. **Branch name**: the Short name, `initiative/` shown before it, one for all its Projects, hint "The Initiative's Short name, one for all its Projects: lower-case a–z, 0–9 and -, at most 40 characters."; switching a Project on fills it from the title when empty (accents dropped, lower-case, each run of other characters one `-`, at most 40 characters cut at a word); with every Project off: "Only with an Initiative's branch: a Project publishing Task by Task needs none."
  3. **Pipeline**: a picker "<Project>'s Pipeline" per Project switched on, placeholder "Choose a Pipeline", no None; switching a Project on picks its Project default Pipeline.
- Save checks before sending: the Short name's form ("Name the branch: the Initiative works on it in each Project switched on." / "Use only lower-case a–z, 0–9 and -, with no - at either end or two in a row.") and a Pipeline for each Project on ("Choose a Pipeline: a Project on an Initiative's branch publishes through one.").
- **Save** sends it all at once; **Cancel** throws the draft away; a refusal shows as "The Pipelines weren't saved" (a Short name another Initiative holds is refused).

## Engine fold

- A fold "Engine" (cpu icon) right after Pipelines, starting folded; remembered per Initiative.
- Summary: the engine it forces, "<engine> · set for this Initiative · no stand-ins", else "<engine> · from the Project" or "<engine> · from the Office default" ("Each Project's engine" across several Projects).
- A switch **Override the engine**; off, the hint reads "Its Threads and Tasks run on their Project's engine, or the Office default where the Project sets none, with that Project's Stand-in Engines."
- On, an **Engine** select over the listed engines, grouped by engine type with each type's icon, starting on the first Project's engine; no model: each person works with their own model and effort for its type.
- Under it, an info note: "No stand-ins: when <engine>'s usage window is used up, its Tasks wait for the reset."
- Each change saves at once with a toast ("<name> runs on <engine>, with no stand-ins." / "<name> has no engine of its own now: its Threads and Tasks run on their Project's engine from their next session."); a refusal shows under the field, headed "The engine wasn't saved".
- Read-only once Done or Dropped.
- An "Its Tasks" list shows which of its Tasks follow its override and which override it with their own engine.
- Rules: [2.1.4](../2.1.4-initiatives.md#an-initiatives-engine), [5.4.5](../5.4.5-engines-and-cascade.md#the-engine-cascade), [5.4.6](../5.4.6-stand-in-engines-and-usage-windows.md#a-forced-engine-has-no-stand-ins).

## Test instances

- A fold "Test instances" (flask icon), shown once the Initiative is active, open while one is Building, Installing or Running; remembered per Initiative.
- Summary: "<n> running · <n> building · <n> built" (each only when not 0), "None running" once every instance has ended, or "None launched yet".
- With no Project on an Initiative's branch: "Test instances launch on an Initiative's branch, and this Initiative publishes Task by Task."
- A group per Project with a branch, its mark and name; one with no test target says "No test targets in <Project>." with a link to its Test targets section.
- A Project with Test targets switched off ([Feature switches](../2.1.1-projects.md#feature-switches)) has no group, and the fold is hidden when no Project on the Initiative's branches has them on.
- A Project whose Run environment isn't On says "Needs Run environment On to launch." on its group, with a link to its Run environment section; its **Launch** is disabled, saying why (the service refuses it too).
- It also shows the instances launched from the Project page on the Initiative's branch ([project-page.md](project-page.md#test-instances)), which are linked to it ([2.12](../2.12-test-instances.md#linking-to-an-initiative)).
- A row per test target: its name, its kind badge, and its newest instance:
  - none yet: its entry point and **Launch** (play icon);
  - **Building** (info, spinner) with **Stop** and **Log**;
  - **Running** (success) with "localhost:<port>" (or "<LAN IP>:<port>") as plain text, not a link, **Open** (a new tab, through the hand-off link), **Stop** and **Log**;
  - **Built** (success) with each file's name and size, **Download**, a **QR code** button and **Log**;
  - for an Install on a device target ([2.12](../2.12-test-instances.md#install-on-a-device)): **Installing** (info, spinner) on "<device>" with **Stop** and **Log**, and **Installed** (success) "on <device>" with **Log**; while it builds it shows Building, and its build shows on the Build to install target's row, "Built for <target>";
  - **Stopped** (neutral) or **Failed** (danger, with why) with **Log**;
  - with **Launch again** once the newest has ended or is Built, and "<short commit> · <time>" of the instance shown, with "Newer commits on the branch" when the branch has moved past it.
- **Launch** shows no toast: the row turns Building.
- A refusal is a toast "<name> can't launch" with the service's reason, and the row stays as it was: over [Test instances at once](../2.12-test-instances.md#test-instances-at-once), Run environment not On, an entry point missing on the branch, no Proxy port free.
- **Stop** asks nothing; toast "<name> stopped."
- **Log** opens a large window "<name> · <state>":
  - under its head: the state, the Project, the branch at its commit, who launched it and when, and the address while Running;
  - the masked log in monospace, The Office's own lines (its steps: checkout, run environment, entry point) set apart from the output, and why it failed in danger;
  - while Building, Installing or Running it streams, reading on from where it is; **Follow** (on at first) keeps the newest line in view, and scrolling up turns it off;
  - its bar: **Open** while Running, **Stop** (danger) while Building, Installing or Running, **Close**.
- **QR code** opens a window "Install <file> on a phone": the QR code, "Works for this file only, for 1 hour." and the link with **Copy link**.
  - At `localhost`: "A phone can't reach localhost. Open The Office at its LAN address to make a QR code that works there." in place of the code.
- Earlier instances of a target fold under its row, "<n> earlier", each with its state, commit, time and **Log**.
- A test instance's Notification opens the page with `testInstance=<id>`: the fold opens, an earlier instance's fold too, and its row scrolls into view ([2.7](../2.7-notifications.md#test-instance-outcomes)).
- Done or Dropped: read-only; Launch is gone, and Built files show until removed ("Removed 7 days after the Initiative ended.").
- A Built instance whose files were removed (an older build past the newest 3, or after the Initiative ended) shows no Download or QR code, and says "Its files were removed.", with its **Log**.
- Rules: [2.12](../2.12-test-instances.md).

## Outcome

- A fold "Outcome" (target icon), open by default.
- Summary: its first line, or "Not written yet".
- **Edit** while shaping only: editor "Outcome" ("What must be true once the Initiative is done, in Markdown."), **Save**, **Cancel**; refusal "The outcome wasn't saved".
- Once active it changes only by a Proposal of whoever shapes Initiatives.
- Empty: "Not written yet."

## Attachments

- A fold "Attachments" (paperclip), open by default, with **Add**.
- Summary: "None" or "<n> Attachments".
- The Initiative's Attachments in one gallery ([2.1.2](../2.1.2-ideas-and-attachments.md)).

## Origin

- A fold "Origin" (lightbulb), folded by default, shown only when the Initiative was shaped from an Idea.
- Summary "Idea: <title>"; body: the Idea linked to Work › Ideas, its Project chip, "captured <day and time>" and its notes.

## History

- A fold "History" (history icon), after Origin, starting folded.
- Summary: "Nothing yet", or "<n> changes · last <when>".
- One row per entry, oldest first: "Created in Backlog by …", "Moved from Ready to Planning by …", "Title edited by …", each with its day and clock.
- Who reads as [2.1.3 History](../2.1.3-tasks.md#history) names them: "the user Ann Lee", "the person in the Role planner".
- Empty: "Nothing has changed yet."; a failed read shows a danger alert "The History wasn't read" with the service's message.
- Rules: [2.1.3](../2.1.3-tasks.md#history).

## Conversation

- A tab per person, built from the Initiative's Threads: the Shaper's tab (whoever holds Shapes Initiatives) first, then the Planner's, each always shown; one tab when one Role holds both; then anyone else with a Thread in the order they joined; a former holder keeps their Threads on their own tab.
- A duty nobody holds gets a placeholder tab named by its label, with the note that nobody holds it.
- A tab's line: "Shapes the outcome and the Tasks with you, and plans them", "Shapes the outcome and the Tasks with you", "Plans the Initiative's Tasks", "Talks with you on this Initiative".
- A tab with one Thread shows it directly; with several, each is a chapter folded to a line of tokens, New-marked when added while the page is open.
- The **To** line goes to the person's newest Thread; a pick among their Threads holds until a newer one starts, and a draft holds it.
- The composer keeps a draft per Thread; the Sub-agents and processes line sits above it.
- An empty tab says why: the Shaper's "No conversation with <name> on <Initiative> yet." with **Shape it with <Shaper>**; the Planner's "No planning on <Initiative> yet. Once it is active with a Task in Backlog, Plan the Initiative has <name> start at once, or Plan with <name> lets you say first how to plan it." with **Plan with <Planner>** while offered; a placeholder "No conversation on <Initiative> yet: nobody holds <duty>."
- An ended Initiative's Threads are read-only with the reason; its empty tabs say "No conversation with <name> on <Initiative>."
- The Planner's decisions in the planning Thread show as Decision cards ([decision-card.md](decision-card.md)); `?initiativeThread=<thread>&decision=<decision>` opens the drawer at that Thread and the timeline lands on the card.
- `initiativeThread` names a tab by Role key (a placeholder's by the duty's key) or by one of the person's Threads, which then unfolds and takes the To line; pressing a tab writes the Role key.
- The first tab (the person with the newest Thread) is chosen once; only the address moves it.
- The Thread view, composer and To line: [thread.md](thread.md).
- Rules: [2.4.1](../2.4.1-threads.md), [2.1.4](../2.1.4-initiatives.md#decisions-in-the-planning-thread).

## States

- Loading: only the tab strip shows until the Initiative and the Tasks are read.
- Missing: an empty state with **Back to Work** and the service's message when it is gone (404), or "The Initiative can't be shown." with its reason.
- Active: **Back to Shaping** while no Task has started; Pipelines editable as above.
- Shaping: the shaping note; Outcome and Pipelines editable; its Tasks sit in Shaping.
- Paused: a **Paused** badge and **Resume the Initiative**; its Tasks show Paused and the queue's reason.
- Done and Dropped: no Pause, Plan or Add; **Archive** in the menu; Pipelines read-only; Threads read-only.
- Archived: **Archived <day>** and **Restore**.
- Narrow window (900px and below): the conversation is a drawer.

## Domain facts

- [Initiative](../2.1.4-initiatives.md#initiative), [Initiative states](../2.1.4-initiatives.md#initiative-states)
- [Plan the Initiative](../2.1.4-initiatives.md#plan-the-initiative), [Plan with…](../2.1.4-initiatives.md#plan-with-on-an-initiative), [Auto mode](../2.1.5-planning-and-start.md#auto-mode)
- [Joining and leaving an Initiative](../2.1.3-tasks.md#joining-and-leaving-an-initiative)
- [The Initiative's branch](../5.5-git-and-isolation.md#the-initiatives-branch), [Deleting merged branches](../5.5-git-and-isolation.md#deleting-merged-branches), [Publish](../2.3.4-publish.md)
- [Test instance](../2.12-test-instances.md#test-instance), [its states](../2.12-test-instances.md#test-instance-states), [reaching a Hosted instance](../2.12-test-instances.md#reaching-a-hosted-instance), [Build to install](../2.12-test-instances.md#build-to-install)
- Related screens: [initiatives-tab.md](initiatives-tab.md), [work-board.md](work-board.md), [task-page.md](task-page.md), [thread.md](thread.md), [decision-card.md](decision-card.md), [archived.md](archived.md)
