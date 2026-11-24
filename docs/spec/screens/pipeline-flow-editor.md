# Pipeline flow editor

Covers: the Pipeline flow editor shared by Settings › Pipelines, a Project's Project Pipelines and a Task's "Edit for this Task" (head, legend, the canvas, routes back and their limit marks, moving and zooming, full screen, the hint, the Stage panel, the linked-template line, Routes out and the route forms, the route panel, the condition builder, the check's problems and warnings, Stage templates, locks), the Proposal on the flow, the moved-flow note.

## Where it is

- It is a block, not a page. Hosts:
  - **Settings › Pipelines** (`/settings/pipelines/$pipelineId`): an office-wide Pipeline, inside the library form's card ([settings.md](settings.md#pipelines)).
  - **A Project's Pipelines** (`/projects/$projectId/pipelines/$projectPipelineId`): a Project Pipeline, inside the form's card ([project-page.md](project-page.md#the-open-project-pipeline)).
  - **Edit for this Task**: the Task's own Stages ([task-page.md](task-page.md)).
  - **A Proposal on the flow**: read-only, under the Proposal's banner ([Proposal on the flow](#proposal-on-the-flow)).
- An office-wide Pipeline and a Project Pipeline get the same editor, with everything in it: dragging, moving, drawing and removing.
- Each host keeps the Stages and applies every edit; the editor keeps only what is picked and the hint.

## Layout

- The head: title and summary, the host's menu (Add a Stage).
- The legend line.
- The hint line.
- The canvas.
- The panel for what is picked.
- The check's problems and warnings.
- On a Pipeline The Office moved, the moved-flow note above the head ([Moved-flow note](#moved-flow-note)).

## Head

- Title **Stages and routes** in every host, with the summary under it.
- Summary: "N Stages · N routes · N routes back" (singular forms at 1: "1 Stage", "1 route", "1 route back").
  - A route back is one to its own Stage or one before it in the Pipeline's order.
- The host's menu **Add a Stage**: **Agent Stage**, **Script Stage**, **Gate**, **Publish Stage**, then **From a template** ([Stage templates](#stage-templates)).
- The host's menu is hidden on a read-only flow.

## Legend

- A list named "What the lines mean": a line sample **Route**, and the limit mark **≤N×** "at most N times".
- A Proposal on the flow: its own legend, naming the one who drafted it.

## Hint

- A line with an info icon under the legend (`role=status`); it says how to use the editor, and after an edit says what the edit did, until the next pick.
- How to use it, wide: "Drag a Stage to move it. Drag from its + to any Stage, itself or an earlier one too, or to End, to draw a route; pick a route to set its condition and its limit. Without a mouse: Tab to a Stage, Shift + arrows move it, Enter opens it below. Drag the canvas with the right mouse button to move around; Ctrl/⌘ + scroll zooms, and F fits the whole Pipeline."
- How to use it, narrow (canvas under 560px wide): "Press a Stage or a route to edit it below. Move and Routes out do everything without dragging; drag from a Stage's + to draw a route."
- Read-only: "Pick a Stage or a route to read it below. Drag the canvas with the right mouse button to move around; Ctrl/⌘ + scroll zooms, and F fits the whole Pipeline."
- What an edit says:
  - Stage added: "<name> was added beside <Stage, or the start>. Drag it where it goes, then draw its routes: drag from a Stage's + to another Stage or to End. Without dragging: Move and Routes out, below."
  - Stage removed: "<name> was removed. Each route that led into it now leads where its one route out led, so a straight line stays one."
  - Stage put on a route: "<name> was put on the route from <Stage>: that route now leads to it, its condition and limit kept, and one route with no condition leads on from it."
  - Route removed: "The route from <Stage> to <target> was removed."
  - Route drawn: "Route drawn from <Stage> to <target>." and, when the Stage has other routes, " As <Stage> has other routes out, set when it is followed, below."
  - Route back drawn: "Route drawn from <Stage> back to <target>, at most 3 times: set its condition and its limit below."
  - Route already there: "<Stage> already has a route to <target>: it is picked below. Two cases that lead there are one route whose condition joins them with Any of."

## Flow view (the canvas)

- A region named "Flow": the Stages in a grid of places (a column and a row each), **End** after the last column, and the routes drawn over it in one SVG.
- The Pipeline's order is the places' order: columns left to right, then rows top to bottom. Stages in one column are alternatives side by side.
- Under 560px wide ("down"), columns become bands from top to bottom and a column's rows sit side by side.
- A line marks where the walk starts: a dot and an arrow into the first Stage.
- **Stage card**:
  - A button named by the Stage, with a kind icon (Agent Stage, Script Stage, Gate, Publish Stage) and its name.
  - Its second line: for an Agent Stage who works it, a Role's name or "<duty label> · <holder>" ("nobody yet" for one naming nobody); for a Script Stage its command by its name; for a Gate "waits for you"; for a Publish Stage "publishes by <mode>" or "pushes the branch only".
  - A flag icon on a Stage with problems (its words as the tooltip), a red outline.
  - On a started Stage, a lock ([Locks](#locks)).
  - A **+** handle named "Draw a route from <Stage>" (hidden on a read-only flow and on locked Stages).
  - Pressing the card picks the Stage.
- **Route rows**: a Stage with several routes, or one with a condition or a limit, lists them inside its card, each row "→ <target> <when> ≤N×", with a port the line leaves from.
  - The when: "when it fails", "if the Agent chooses: <words>", "when <condition in words>", "when it ends Conflict" (a Publish Stage's results, joined by "or"), "otherwise", "always".
  - The mark ≤N× only on a route with a limit.
  - A Stage with one route, with no condition and No limit, lists none, and the line leaves its edge.
  - A row or line named "Route from <Stage> to <target>" (", at most N times" on one with a limit); pressing picks the route; a route with no row is reached by Tab on its line.
  - A card with only routes that have conditions shows "When none holds, you're asked" (a warning icon; its tooltip the check's warnings).
  - A picked route is highlighted; a route with a problem is red.
- **Routes back** are drawn as ordinary solid routes, curving back above the Stages (beside them, down), with the ≤N× mark on the line.
  - A route on with a limit shows its mark on its line too.
  - A route to its own Stage leaves and enters its top edge (its left edge, down).
  - Each route back runs in a lane of its own above the Stages; lanes sit a mark's height apart and clear of the cards, and routes back that only meet at a column share one.
  - Routes back that leave or enter the same Stage each take a point of their own, spread across its top edge (its left edge, down).
  - A route back whose either end has another card above it (beside it, down) runs in a lane under the Stages instead (on their other side, down), entering and leaving the bottom edges.
  - With cards on both sides of an end, it leaves that Stage's side and runs along the gutter between columns, never through a card.
  - The mark sits on its route's own run, at the free spot nearest the middle where no other line crosses and clear of the marks on the lanes beside it; with none free, in the middle of the run's widest stretch between crossings.
- **Dragging** (wide canvas, a Stage that can be moved):
  - A Stage is dragged to a cell; dropping into a taken cell puts it on the first free row below; dropping between columns makes a new column and the later columns shift right. The drop target shows a ghost.
  - A drag starts after 5px of movement; a press without it picks the Stage.
  - Dragging from a Stage's + to any Stage, its own included, or to End draws a route; **End** lights up as a target.
  - A touch that becomes a scroll cancels and drops nothing.
  - Dragging a Task's started Stage says why where it was pressed: "<Stage> has started, so it stays where it is."
- Moving a Stage changes the Pipeline's order, so a route may turn from a route on into a route back, or back; its limit stays as it is, and the check says when a loop is left with none.
- **Keyboard**:
  - Arrows (Left/Right/Up/Down across; Up/Down for the order and Left/Right for rows when narrow) pick the previous or next Stage in the Pipeline's order.
  - Shift + an arrow moves the picked Stage a step (focus stays on it).
  - Delete or Backspace on a route's line, or with a route picked, removes it.
- Moving a Stage: alone in its column, earlier and later swap the column with its neighbour; sharing a column, it goes into the neighbouring column (a new first column before the first); up and down swap rows with the Stage on the neighbouring row. A move that would change nothing is disabled.

## Moving and zooming

- A Stage keeps its size on the canvas; a large Pipeline grows past the view, which moves and zooms instead of squeezing it.
- The view is a group named "Flow view: arrow keys move it, + and − zoom, F fits the Pipeline"; focused, arrow keys move it, + and − zoom, F fits.
- Moving the view: a drag with the right mouse button, the middle one, Space + drag, or a drag on the empty canvas. A plain scroll stays the page's.
- Zooming: Ctrl/⌘ + scroll, or the controls in the canvas's corner (a toolbar named "Canvas"), from 25% to 100%.
  - **Zoom out (−)** and **Zoom in (+)**; at the ends disabled with "Already at 25%, the smallest" or "Already at 100%, a Stage's own size".
  - The zoom readout (e.g. "75%") opens a menu: **Fit the Pipeline** (F), **100%** (0), **75%**, **50%**, **25%**.
  - **Fit the Pipeline (F)** shows the whole Pipeline.
- Under 60% a Stage shows only its name.
- **Overview**: a small map in the canvas's corner while the Pipeline doesn't fit ("Overview: press or drag to move the view"); its toggle reads **Show the Overview** or **Hide the Overview**, and is disabled with "The whole Pipeline is in view" when it all fits.
- Dragging a Stage near the view's edge moves the view along.

## Full screen

- **Full screen** in the canvas's controls gives the editor the whole window (a dialog named "Stages and routes, full screen"); the page under it doesn't scroll.
- Its title is the editor's title after "<name> ·": the Pipeline's name (or "New Pipeline"), or the Task's title.
- Its bar keeps the host's Save at hand: Settings' and a Project Pipeline's save row, "Edit for this Task"'s save actions.
- **Exit full screen** (in its head, and the control's "Exit full screen (Esc)") or Esc goes back.

## Stage panel

- Under the canvas. Empty: "Pick a Stage or a route to edit it here." and "A Stage's settings and its Routes out; a route's place, its condition and its limit."
- Head: the Stage's name with its kind and place: "<kind> · N of M in the Pipeline's order".
- Tools: **Move <Stage> earlier**, **later**, **up** and **down** (chevrons), then a ⋯ menu "More for <Stage>":
  - **Save <Stage> as a template**: adds a Stage template ([Stage templates](#stage-templates)); toast "<name> saved as a Stage template."; refusal "<name> wasn't saved as a Stage template".
  - **Remove <Stage>** (danger): each route that led into it leads where its one route out led (several routes out, or none: the routes into it go and the check says where one is missing).
  - Not shown on a locked Stage.
- Body, in order: the problems on this Stage (one by its words, several as "N problems here"), the linked-template line on a linked Stage ([Linked-template line](#linked-template-line)), the Stage form, **Routes out** ([Routes out](#routes-out)).
- **Stage form**, by kind:
  - All: **Name** (a Gate's hint "A label for you; the Agents don't read it or act on it").
  - Agent Stage:
    - **Who works it**: grouped choices, **Duties** ("<duty> · <holder name · title>" or "… · nobody holds it"; hint "A duty's holder when the Stage starts, as Settings › Duties sets, or a person with a Task limit") and **People** ("<name> · <title>", only those hired with a Task limit; one the Stage names that no longer qualifies stays listed with "(nobody fills it)", "(let go)" or "(talks only)").
    - **Session**: "Fresh, with a brief" or "Continue the previous Stage's session" (only with the same Role or duty in the Stage before; hint "Continuing needs the same Role or the same duty in the Stage before").
    - **Merge the base first**: a checkbox, off for a new Stage; hint "As it starts, The Office merges the base into the Task's branch and leaves any conflicts for the Agent to resolve."
    - **Budget**: a number, suffix "k tokens", hint "Reaching it asks you"; kept as typed until it is a number above 0.
    - **Effort**: "Person's effort" or one of the efforts; hint "Wins over the person's and the Project's; one the engine type doesn't take gives way to the person's".
    - **Context limits**: "Office default (100k / 180k)", "Set for this Stage" (a **Soft limit** and a **Hard limit**, in k tokens) or "No limit" (never restarts on context size).
    - **Brief**: hint "Filled with the Task's Plan, Definition of Done and earlier results".
    - **Permission profile**, hint "Narrows the Role card's for this Stage, never widens it" (shown once a Role is known): **Files** (the Role default, or reads only), **Runs**, **Web**, an **MCP tool <key>** select per tool of the Role's MCP servers, and **Project commands** (tags; hint "Only these of the Project's commands; never install"). Each offers only what is narrower than the Role card ("Role default: <words>").
  - Script Stage: **Project command** (hint "Runs with no Agent; the result is recorded"), choices from the Project's commands (a Project Pipeline, Edit for this Task) or every Project's (Settings), never Publish, and in Settings **another key**, which opens **Command key** (hint "Lower-case letters, digits and -, as the Project's commands name it"; a wrong key says `"<key>" isn't a command key: lower-case letters, digits and -, starting with a letter, and not install or publish.`).
  - Publish Stage:
    - **Publishes**: "By the Project's publishing mode" or "Push the branch only (proof of concept)".
    - A note: "The Office publishes with its own git and credentials: no Agent and no Project command runs here. Before and After publishing are set on the Project page."
  - Gate: a disabled **What you see**: "The diff, results, Attachments and screenshots so far".
- A locked Stage's panel reads only ([Locks](#locks)).

## Linked-template line

- On a Stage linked to its Stage template, a line above the Stage form: "Linked to the template <name> · Same as the template", or "· Differs in <fields>" ("· Differs in Budget and Brief").
- **Take the template's**, shown while it differs: a menu of each field it differs in by name, then **All its fields**; picking one sets that field, or all, back to the template's in the draft.
- **Unlink**: the Stage keeps its fields as they are and is no longer linked; the line goes.
- Name and routes are the Pipeline's own, so they never make a Stage differ.
- On a Task's own Stages (Edit for this Task) there is no line: they are copies.

## Routes out

- Section **Routes out · N** with **Add a route**, a menu by the Stage's kind:
  - Agent Stage: **The Agent chooses it**, **When these hold**, **When it fails** (only while it has none), **Otherwise** (only while it has none).
  - Script Stage and Gate: **When these hold**, **Otherwise** (only while it has none).
  - Publish Stage: **When it ends…**, **Otherwise** (only while it has none).
- A row added goes to the first later Stage it has no route to, or End; the user then sets where it goes.
- A numbered list in the order the walk weighs them:
  - When it fails first, then the choices and When these hold rows in the order the user sets, then Otherwise last.
  - Each row shows its when-words ("When it fails", "The Agent chooses it when <words>", "When <condition in words>", "When it ends Conflict", "Otherwise"), its problems, **Goes to** and **At most**.
  - **Goes to**: a select of every Stage of the Pipeline in its order, the row's own Stage included, and **End**.
  - **At most**: a stepper 1 to 9 with "times", and a **No limit** choice; a route back starts at 3, a route on at No limit.
  - Pressing a row's words picks the route.
  - Row tools: **Move the route to <target> up**, **down**, **Remove the route to <target>**; moves never take a row above When it fails or below Otherwise.
- Empty: "No route out yet. Add one to any Stage, or to End to make <Stage> a final Stage."
- Hints:
  - All: "The walk follows the first route whose condition holds, from the top. Otherwise always holds, so it goes last. To run a Stage only in some cases, give the route into it a condition."
  - Agent Stage: "The Agent reads each choice's words and chooses one as it ends, giving its reason. When it fails goes first and Otherwise last; without a choice, Otherwise is followed."
  - Limit: "A route back starts at 3, a route on at No limit. Every loop needs one route with a limit, so the walk always ends."
- A route drawn on the canvas:
  - The first route out is an Otherwise.
  - A later one goes in before Otherwise: on an Agent Stage as a choice with no words yet, on a Script Stage or a Gate as When these hold with an empty condition ("All of", no test), on a Publish Stage as When it ends… with no result ticked; the check asks the user to fill it.
  - A route to where one already leads is that one.
  - A route back, to the Stage itself or an earlier one, starts at at most 3 times; a route on, at No limit.

## Route panel

- Head: "Route from <Stage> to <target>", "N of M routes out of <Stage>".
- Tools: **Insert a Stage on this route** (the Add a Stage menu: the Stage kinds, then From a template) and **Remove route** (danger).
  - Inserting: the route leads to the new Stage, its condition and limit kept; one route with no condition leads from it to the old target, with the default limit for where it leads; it takes a column right after the route's Stage.
- **Goes to**: a select of every Stage of the Pipeline in its order, the route's own Stage included, and **End**. Hint "Any Stage, this one or an earlier one to go back, or End to make <Stage> a final Stage."
- **At most**: a stepper 1 to 9 with "times", and **No limit**.
- The condition, by the row's kind:
  - The Agent chooses it: a text field **When the Agent chooses it**, placeholder "In plain words, such as: the review found something to fix".
  - When these hold: the [condition builder](#condition-builder).
  - When it fails: no field; "When <Stage> ends Failed."
  - When it ends…: a checkbox per result, **Published**, **Nothing to publish**, **Conflict**, **After publishing failed** and **Failed**; a result another row takes is disabled, with "Goes to <target> by another route".
  - Otherwise: no field.
- The sentence under it says when the route is followed and its limit:
  - "Followed when the Agent chooses it, at most 3 times in a walk; then you're asked (or the CTO first)."
  - "Followed when <condition in words>, …", "Followed when <Stage> fails, …", "Followed when it ends Conflict, …", "Followed otherwise, when no route before it holds, …".
  - With No limit: "…, with no limit."
  - With no condition and no other route: "Always followed: it is <Stage>'s one route out."
- A route with a Project command test adds: "<keys> runs as <Stage> ends, as a Script Stage's command runs: in the Task's worktree, with the Task's earlier Stage runs in the file OFFICE_STAGE_RUNS_FILE names. It holds when it exits 0; one that can't run stops the walk and asks you. Its output is kept on <Stage>'s run."
- Problems on the route show at the top; a locked Stage's route reads only.

## Condition builder

- Shown for **When these hold**: a group with **All of** / **Any of** (a segmented control) and "these hold" / "these holds"; its tests below, each joined by "and" or "or"; nested groups to any depth, each with **Remove this group**.
- A test is two selects (and a stepper):
  - **What it tests**: "The previous Stage (<name>)", every Stage of the Pipeline by name, in its order, **The Definition of Done**, **A Project command**; a Stage no longer in the Pipeline stays listed with "(gone)".
  - **Test**:
    - For a Stage: **ended Done**, **ended Failed**, **was Skipped**, **changed files**, **changed no files**, **ran N or more times** (with a **Times** stepper, 1 to 20).
    - For a Publish Stage, besides: **ended Published**, **ended Nothing to publish**, **ended Conflict**, **ended After publishing failed**.
    - For the Definition of Done: **is all Reported met**, **has some not Reported met**.
    - For a Project command: the **Project command** select (a Project's commands as "<key> · <line or not set>", in Settings every key as "<key> · in <Projects>"; "Choose a command…" while none is picked), with "Holds when it exits 0."
  - **Remove this test**.
- At each group's foot: **Add a test** (starts with "the previous Stage ended Done") and **Add a group** (combines the other way and starts with "the previous Stage ended Failed").
- A new condition starts as All of with the test "the previous Stage ended Done".
- An empty group shows "No test yet: add one, or remove this group." and is a problem that holds Save.
- A test's problem shows on its select; a group's under it.
- Words of a condition: tests joined by "and" or "or"; a nested group of two reads "both … and …" or "either … or …", of more "all of: …" or "any of: …".

## Problems and warnings

- Below the panel, above the host's bar:
  - Problems (a warning alert titled "The Pipeline can't be saved yet", "These Stages can't be saved yet" for Edit for this Task, or "The Stage template can't be saved yet"): they hold Save. Each on a Stage is a link that picks where it is (a Stage, a route, a test) and scrolls to the panel.
  - Warnings (an info alert "Worth a look, though it doesn't hold Save"), such as a Role nobody fills.
- Problems of the routes, among the [Validation](../2.3.2-flows.md#validation) rules:
  - "<Stage>: the loop <A → B → A> has no route with a limit, so it could run for ever."
  - "<Stage>: no path of routes leads from it to End."
- A warning: "Publish: no route takes Conflict, so a conflict asks you." (by the Publish Stage's name).
- Beside the service's check, the editor refuses on its own a condition group with no test: "Stage N · <name>: its route to <target> has a group with no test yet: add a test, or remove the group."
- What makes a flow unusable (a Stage no route reaches, a loop with no limit, a Stage with no way to End) is the service's check to say; an edit is never refused for it.

## Stage templates

- **Add a Stage** (every host but a Proposal) is a menu "Add a Stage" with **Agent Stage**, **Script Stage**, **Gate**, **Publish Stage**, then **From a template** listing the Stage templates by name (each with its kind icon); the same menu is under **Insert a Stage on this route**.
  - Disabled item when none: "No Stage template yet. Make one in Settings › Pipelines, or save a Stage as one."; a read error: "The Stage templates can't be read".
  - A new Stage: named "New Stage" (Agent Stage), "Script", "Gate" or "Publish"; a name and key no other Stage has; added in a column of its own right after the picked Stage, a row below it, or after the last on row 0, with no routes (drawn after).
  - A new Publish Stage publishes by the Project's publishing mode.
- A template added to a Pipeline's Stages, office-wide or a Project's, is linked to it ([Linked-template line](#linked-template-line)); added to a Task's own Stages, it is a copy.
- **Save as a template** (⋯ menu) saves the Stage without its key, place and routes; in a Pipeline the Stage is then linked to the new template.
- Templates are made, edited and removed in Settings › Pipelines, which lists their linked Stages and asks which get an edit ([settings.md](settings.md#pipelines)).

## Locks

- Used by Edit for this Task: each Stage already started is locked, marked with its state ("Done", …) and a lock icon with "<state>: started, so it can't be changed".
- A locked Stage can't be dragged, moved, removed or drawn from; its panel's fields and Routes out (where each leads, its condition, its limit and their order) are disabled, with that note as the tooltip, and the panel opens with a lock note.
- The columns up to the last holding a locked Stage are frozen: no Stage or column is made or closed up among them, and a Stage added goes after them.
- Routes into a locked Stage can be drawn and changed, routes back included.
- What still breaks a lock (a Stage put straight after a started one) the service's check names.

## Proposal on the flow

- Shown with `?proposal=<id>` naming an open Proposal of a Pipeline's routes, instead of the form: in Settings › Pipelines for an office-wide Pipeline, in a Project's Pipelines section for a Project Pipeline.
- A banner (`role=status`) "<name>'s Proposal, shown on <Pipeline>: not applied yet": the sentences saying what each changed Stage's routes become, with their limits, "Dashed lines are what it proposes; dotted ones, what it takes away. Nothing changes until you apply it."; actions **Apply change**, **Not now** (the Proposal is left) and, when the chat isn't beside, **Back to the Thread**; a refusal **The change can't be applied yet**.
- Toasts on apply: "<Pipeline> changed. Tasks that haven't started follow it." (office-wide) and "<Pipeline> saved. Tasks that haven't started follow it." (Project Pipeline).
- The editor is read-only: no menu, no +, no dragging, no keyboard edits.
- Each changed Stage keeps the routes it had; proposed routes are dashed, those taken away dotted.
- Picking a changed Stage shows its routes, each with its limit, as Was and Proposed under the flow.
- A Proposal's warnings come from its routes' check.
- A Stage the Proposal removes isn't drawn on its flow, and neither are its routes.

## Moved-flow note

- On a Pipeline The Office moved to routes back and Publish Stages ([2.3.5](../2.3.5-library.md#the-move-to-routes-back-and-publish-stages)), office-wide or a Project's, an info alert "<name> now goes back by routes" with **Hide this note**.
- Text: "As The Office updated, each On failure setting became a route back with the same limit, Publish became a Publish Stage, and a conflict at Publish now goes by the conflict chain drawn in: Resolve, Test after Resolve, then Publish again. Tasks walk it as before."
- Hiding is this browser's (kept by the Pipeline's id), never sent to the service.

## States

- Loading: a host shows nothing until its Roles, duties and options are read (Project Pipelines) or shows its own errors.
- Waiting for the check: Save in the host is held while the service's answer is awaited; the Stages shown are the last answer's.
- Narrow window:
  - Canvas under 560px wide: "down" layout and its hint.
  - Settings and Project Pipelines show the list or the open one under 1224px ([project-page.md](project-page.md#pipelines)).
- Locked and read-only forms are described above.

## Domain facts

- A Pipeline is a flow, routes and their limits, the Pipeline's order, the route forms: [2.3.2](../2.3.2-flows.md#a-pipeline-is-a-flow), [2.3.2](../2.3.2-flows.md#a-routes-limit), [2.3.2](../2.3.2-flows.md#the-pipelines-order), [2.3.2](../2.3.2-flows.md#which-route-the-walk-follows), [2.3.2](../2.3.2-flows.md#the-route-forms).
- An Agent's choice, conditions, a limit running out, validation, Proposals: [2.3.2](../2.3.2-flows.md#how-an-agent-chooses-its-route), [2.3.2](../2.3.2-flows.md#built-in-conditions), [2.3.2](../2.3.2-flows.md#the-project-command-condition), [2.3.2](../2.3.2-flows.md#when-a-limit-runs-out), [2.3.2](../2.3.2-flows.md#validation), [2.3.2](../2.3.2-flows.md#route-and-condition-proposals).
- Stage kinds and fields, a linked Stage, merging the base first: [2.3.1](../2.3.1-stages.md#stage-kinds), [2.3.1](../2.3.1-stages.md#what-a-stage-declares), [2.3.1](../2.3.1-stages.md#a-stage-linked-to-its-stage-template), [2.3.1](../2.3.1-stages.md#an-agent-stage-may-merge-the-base-first).
- A Stage's effort in the model and effort cascade: [5.4.5](../5.4.5-engines-and-cascade.md#the-model-and-effort-cascade).
- Gates: [2.3.3](../2.3.3-gates-and-checks.md#gates).
- The Publish Stage, its results, the conflict chain and Resolve: [2.3.4](../2.3.4-publish.md#publish), [2.3.4](../2.3.4-publish.md#publishs-results), [2.3.4](../2.3.4-publish.md#conflicts-in-the-flow), [2.3.4](../2.3.4-publish.md#the-resolve-stage).
- The library editor, Stage templates and their linked Stages, Project Pipelines, the move: [2.3.5](../2.3.5-library.md#the-library-editor), [2.3.5](../2.3.5-library.md#stage-templates), [2.3.5](../2.3.5-library.md#editing-a-template-with-linked-stages), [2.3.5](../2.3.5-library.md#project-pipelines), [2.3.5](../2.3.5-library.md#the-move-to-routes-back-and-publish-stages).
