# Pipeline flow editor

Covers: the Pipeline flow editor shared by Settings › Pipelines, a Project's Project Pipelines and a Task's "Edit for this Task" (head, Flow and List views, the canvas, moving and zooming, full screen, the hint, the Stage panel, Routes out, route conditions, On failure loops, the check's problems and warnings, Stage templates, locks, marks), the Proposal on the flow, the converted-flow note.

## Where it is

- It is a block, not a page. Hosts:
  - **Settings › Pipelines** (`/settings/pipelines/$pipelineId`): an office-wide Pipeline, inside the library form's card ([settings.md](settings.md)).
  - **A Project's Pipelines** (`/projects/$projectId/pipelines/$projectPipelineId`): a Project Pipeline, inside the form's card ([project-page.md](project-page.md#the-open-project-pipeline)).
  - **Edit for this Task**: the Task's own Stages ([task-page.md](task-page.md)).
  - **A Proposal on the flow**: read-only, under the Proposal's banner ([Proposal on the flow](#proposal-on-the-flow)).
- Each host keeps the Stages and applies every edit; the editor keeps only what is picked, the view and the hint.

## Layout

- The head: title and summary, the host's menu (Add a Stage, or Insert), the **View** switch (Flow / List).
- The legend line.
- The hint line.
- The canvas (Flow) or the list (List).
- The panel for what is picked.
- The check's problems and warnings.
- A Project Pipeline adds, above the head, the Stage changes that don't apply ([In a Project Pipeline](#in-a-project-pipeline)).

## Head

- Title, with the summary under it:
  - Settings and "Edit for this Task": **Stages and routes**.
  - A Project Pipeline: **What <Project> gets**.
- Summary, office-wide: "N Stages · N routes · N On failure loops" (singular forms at 1). A Gate's On failure isn't counted.
- Summary, a Project Pipeline: "N Stages: <base>'s M, with K Stage changes", or "<base>'s M Stages as they are: no Stage change yet".
- **View**: **Flow** (workflow icon) and **List** (list icon). Flow is first; the choice isn't kept.
- The host's menu is hidden on a read-only flow.

## Legend

- Office-wide: a line sample **Route** and a dashed red line sample **On failure loop** (list named "What the lines mean").
- A Project Pipeline (list named "What the marks mean"): **From <base>**, **Inserted**, **Replaced**, **Changed or routes changed**, **Removed** (each an edge colour) and **On failure loop**.
- A Proposal on the flow: its own legend, naming the one who drafted it.

## Hint

- A line with an info icon under the legend (`role=status`); it says how to use the editor, and after an edit says what the edit did, until the next pick.
- How to use it, Flow, wide: "Drag a Stage to move it. Drag from its + to another Stage, or to End, to draw a route; pick a route to set its condition. Without a mouse: Tab to a Stage, Shift + arrows move it, Enter opens it below. Drag the canvas with the right mouse button to move around; Ctrl/⌘ + scroll zooms, and F fits the whole Pipeline."
- How to use it, Flow, narrow (canvas under 560px wide): "Press a Stage or a route to edit it below. Move and Routes out do everything without dragging; drag from a Stage's + to draw a route."
- How to use it, List: "The same flow as a list, in the Pipeline's order: move a Stage with its arrows, and add or edit its routes under Routes out."
- Read-only: "Pick a Stage or a route to read it below. Drag the canvas with the right mouse button to move around; Ctrl/⌘ + scroll zooms, and F fits the whole Pipeline."
- A Project Pipeline, Flow wide: "Pick a Stage or a route to edit it below: a route's edit becomes a Change routes Stage change, with its Undo, and an edit of one of a Stage's own fields a Change Stage change of only that field. A Project Pipeline's Stages keep the places its base Pipeline gives them. Drag the canvas with the right mouse button to move around; Ctrl/⌘ + scroll zooms, and F fits the whole Pipeline."
- A Project Pipeline, Flow narrow: "Press a Stage or a route to edit it below: a route's edit becomes a Change routes Stage change, with its Undo. Drag from a Stage's + to draw a route."
- A Project Pipeline, List: "The same flow as a list, in the Pipeline's order: pick a Stage to edit it below, and its routes under Routes out. Each edit becomes a Stage change."
- What an edit says:
  - Stage added: "<name> was added beside <Stage, or the start>. Drag it where it goes, then draw its routes: drag from a Stage's + to another Stage or to End. Without dragging: Move and Routes out, below."
  - Stage removed: "<name> was removed. Each route that led into it now leads where its one route out led, so a straight line stays one."
  - Stage put on a route: "<name> was put on the route from <Stage>: that route now leads to it, its condition kept, and one route with no condition leads on from it."
  - Route removed: "The route from <Stage> to <target> was removed."
  - Route drawn: "Route drawn from <Stage> to <target>." and, when the Stage has other routes, " As <Stage> has other routes out, set when it is followed, below."
  - Route already there: "<Stage> already has a route to <target>: it is picked below. Two cases that lead there are one route whose condition joins them with Any of."
  - A Stage inserted (Project Pipeline): "<name> was inserted after <Stage>: it takes <Stage>'s routes out, and <Stage> gets one route to it." or "… before <Stage>: the routes into <Stage> lead to it, and it gets one route to <Stage>."

## Flow view (the canvas)

- A region named "Flow": the Stages in a grid of places (a column and a row each), **End** after the last column, and the routes and On failure loops drawn over it in one SVG.
- The Pipeline's order is the places' order: columns left to right, then rows top to bottom. Stages in one column are alternatives side by side.
- Under 560px wide ("down"), columns become bands from top to bottom and a column's rows sit side by side.
- A line marks where the walk starts: a dot and an arrow into the first Stage.
- **Stage card**:
  - A button named by the Stage, with a kind icon (Agent Stage, Script Stage, Gate), its name and who works it: a Role's name, "<duty label> · <holder>" (or "nobody yet"), a Script Stage's command by its name, "waits for you" for a Gate; "nobody yet" for an Agent Stage naming nobody.
  - A flag icon on a Stage with problems (its words as the tooltip), a red outline.
  - A mark badge and, on a started Stage, a lock ([Locks](#locks)).
  - A **+** handle named "Draw a route from <Stage>" (hidden on a read-only flow and on locked Stages).
  - Pressing the card picks the Stage.
- **Route lines**: a Stage with several routes, or one with a condition, lists them inside its card, each row "→ <target> <when>" (when: "when <condition in words>", "always", "otherwise") with a port the line leaves from. A Stage with one route and no condition lists none and the line leaves its edge.
  - A row or line named "Route from <Stage> to <target>"; pressing picks the route; a route with no row is reached by Tab on its line.
  - A card with only routes that have conditions shows "When none holds, you're asked" (a warning icon; its tooltip the check's warnings).
  - A picked route is highlighted; a route with a problem is red.
- **On failure loops**: a dashed red line from a Stage back to an earlier one, with a mark "↺ N×" (named "On failure, <Stage> goes back to <target>, at most N times"); pressing it opens the Stage at On failure.
  - Each loop runs in a lane of its own above the Stages (beside them, down); lanes sit a mark's height apart and clear of the cards, and loops that only meet at a column share one.
  - Loops that leave or enter the same Stage each take a point of their own, spread across its top edge (its left edge, down).
  - A Stage with another card above it (beside it, down) sends its loops out of its side and up the gutter between columns, never through a card.
  - The mark sits on its loop's own run, at the free spot nearest the middle where no other loop's line crosses and clear of the marks on the lanes beside it; with none free, in the middle of the run's widest stretch between crossings.
- **Dragging** (wide canvas, a Stage that can be moved):
  - A Stage is dragged to a cell; dropping into a taken cell puts it on the first free row below; dropping between columns makes a new column and the later columns shift right. The drop target shows a ghost.
  - A drag starts after 5px of movement; a press without it picks the Stage.
  - Dragging from a Stage's + to another Stage or to End draws a route; **End** lights up as a target.
  - A touch that becomes a scroll cancels and drops nothing.
  - Dragging a Stage that keeps its place says why where it was pressed: a Project Pipeline's "Its place comes from <base>, the base Pipeline: move it there."; a Task's started Stage "<Stage> has started, so it stays where it is."
- **Keyboard**:
  - Arrows (Left/Right/Up/Down across; Up/Down for the order and Left/Right for rows when narrow) pick the previous or next Stage in the Pipeline's order.
  - Shift + an arrow moves the picked Stage a step (focus stays on it).
  - Delete or Backspace on a route's line, or with a route picked, removes it.
- Moving a Stage: alone in its column, earlier and later swap the column with its neighbour; sharing a column, it goes into the neighbouring column (a new first column before the first); up and down swap rows with the Stage on the neighbouring row. A move that would change nothing is disabled.
- A removed Stage (a Project Pipeline's) stays in its place, dashed and struck through, its old routes dotted, and can't be moved or drawn from.

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

## List view

- An ordered list named "Stages in the Pipeline's order": a numbered row per Stage with its kind icon, name, who works it and its first problem; its mark and lock.
- Arrows **Move <Stage> earlier** and **Move <Stage> later** (hidden on a Project Pipeline, whose Stages keep the base Pipeline's places, and on a read-only flow).
- Under each Stage, its routes as lines "→ <target> <when>" (named "Route from <Stage> to <target>") and its loop "On failure: back to <Stage>, at most N×".
- A Project Pipeline's removed Stages follow, struck through; then a last row **End**: "A route to End makes a final Stage".
- Delete or Backspace on a route's line removes it.

## Stage panel

- Under the canvas. Empty: "Pick a Stage or a route to edit it here." and "A Stage's settings, its Routes out and its On failure loop; a route's place and its condition."
- Head: the Stage's name with its kind and place: "<kind> · N of M in the Pipeline's order".
- Tools: **Move <Stage> earlier**, **later**, **up** and **down** (chevrons), then a ⋯ menu "More for <Stage>":
  - **Save <Stage> as a template**: adds a Stage template ([Stage templates](#stage-templates)); toast "<name> saved as a Stage template."; refusal "<name> wasn't saved as a Stage template".
  - **Remove <Stage>** (danger): each route that led into it leads where its one route out led (several routes out, or none: the routes into it go and the check says where one is missing), and every On failure going back to it is cleared.
  - Not shown on a locked Stage.
- Body, in order: the problems on this Stage (one by its words, several as "N problems here"), the Stage form, **Routes out**, **On failure** (not for a Gate).
- **Stage form**, by kind:
  - All: **Name** (a Gate's hint "A label for you; the Agents don't read it or act on it").
  - Agent Stage:
    - **Who works it**: grouped choices, **Duties** ("<duty> · <holder name · title>" or "… · nobody holds it"; hint "A duty's holder when the Stage starts, as Settings › Duties sets, or a person with a Task limit") and **People** ("<name> · <title>", only those hired with a Task limit; one the Stage names that no longer qualifies stays listed with "(nobody fills it)", "(let go)" or "(talks only)").
    - **Session**: "Fresh, with a brief" or "Continue the previous Stage's session" (only with the same Role or duty in the Stage before; hint "Continuing needs the same Role or the same duty in the Stage before").
    - **Budget**: a number, suffix "k tokens", hint "Reaching it asks you"; kept as typed until it is a number above 0.
    - **Effort**: "Person's effort" or one of the efforts; hint "Wins over the person's and the Project's; one the engine type doesn't take gives way to the person's".
    - **Context limits**: "Office default (100k / 180k)", "Set for this Stage" (a **Soft limit** and a **Hard limit**, in k tokens) or "No limit" (never restarts on context size).
    - **Brief**: hint "Filled with the Task's Plan, Definition of Done and earlier results".
    - **Permission profile**, hint "Narrows the Role card's for this Stage, never widens it" (shown once a Role is known): **Files** (the Role default, or reads only), **Runs**, **Web**, an **MCP tool <key>** select per tool of the Role's MCP servers, and **Project commands** (tags; hint "Only these of the Project's commands; never install"). Each offers only what is narrower than the Role card ("Role default: <words>").
  - Script Stage: **Project command** (hint "Runs with no Agent; the result is recorded"), choices from the Project's commands (a Project Pipeline, Edit for this Task) or every Project's (Settings), Publish among them, and in Settings **another key**, which opens **Command key** (hint "Lower-case letters, digits and -, as the Project's commands name it"; a wrong key says `"<key>" isn't a command key: lower-case letters, digits and -, starting with a letter, and not install.`).
  - The Publish Script Stage adds **Publishes** ("By the Project's publishing mode" or "Push the branch only (proof of concept)") and, unless branch only, **After a conflict** ("Publish automatically" or "Wait at a Gate for your review"; hint "The Task's person resolves it and the Project's Test runs first").
  - Gate: a disabled **What you see**: "The diff, results, Attachments and screenshots so far".
- A locked Stage's panel reads only ([Locks](#locks)).

## Routes out

- Section **Routes out · N** with **Add a route**: it draws a route to the first later Stage it has none to, or End.
- A numbered list in the order the walk weighs them; each row shows "→ <target>" and its words ("when …", "always", "otherwise") and the route's problems; pressing it picks the route. Row tools: **Move the route to <target> up**, **down**, **Remove the route to <target>**.
- Empty: "No route out yet. Add one to a later Stage, or to End to make <Stage> a final Stage."
- Hint: "The walk follows the first route whose condition holds, from the top. One with no condition always holds, so it goes last. To run a Stage only in some cases, give the route into it a condition."
- A drawn route:
  - The first route needs no condition.
  - A later one goes in before the first route with none, with an empty condition ("All of", no test) that the check asks the user to fill.
  - A route to where one already leads is that one.
  - A route leading back or to the same column is drawn too; the check says why it can't stay.

## Route panel

- Head: "Route from <Stage> to <target>", "N of M routes out of <Stage>".
- Tools: **Insert a Stage on this route** (a menu of Stage kinds, with Stage templates; not in a Project Pipeline) and **Remove route** (danger).
  - Inserting: the route leads to the new Stage, its condition kept; one route with no condition leads on from it; it takes a column right after the route's Stage.
- **Goes to**: a select of every other Stage in the Pipeline's order and **End**; a Stage in an earlier column is marked "(earlier: refused)", in the same column "(same column: refused)", and a Stage no longer in the flow "(gone)". Hint "A later Stage, or End to make <Stage> a final Stage. To go back, use <Stage>'s On failure."
- **Condition**: radios:
  - **No condition**: "Always holds. With other routes out of <Stage>, it goes last, as otherwise."
  - **When these hold**: "Built-in tests of a Stage or the Definition of Done, or a Project command that exits 0, in All of and Any of groups."
- The sentence under it: "Followed when <condition in words>.", or with no condition "Always followed: it is <Stage>'s one route out.", "Followed otherwise, when no route before it holds.", or "Always holds, so no route after it can be followed."
- A route with a Project command test adds: "<keys> runs as <Stage> ends, as a Script Stage's command runs: in the Task's worktree, with the Task's earlier Stage runs in the file OFFICE_STAGE_RUNS_FILE names. It holds when it exits 0; one that can't run stops the walk and asks you. Its output is kept on <Stage>'s run."
- Problems on the route show at the top; a locked Stage's route reads only.

## Condition builder

- Shown for **When these hold**: a group with **All of** / **Any of** (a segmented control) and "these hold" / "these holds"; its tests below, each joined by "and" or "or"; nested groups to any depth, each with **Remove this group**.
- A test is two selects (and a stepper):
  - **What it tests**: "The previous Stage (<name>)", each earlier Stage by name, **The Definition of Done**, **A Project command**; a Stage later or gone stays listed with "(later)" or "(gone)".
  - **Test**:
    - For a Stage: **ended Done**, **ended Failed**, **was Skipped**, **changed files**, **changed no files**, **ran N or more times** (with a **Times** stepper, 1 to 20).
    - For the Definition of Done: **is all Reported met**, **has some not Reported met**.
    - For a Project command: the **Project command** select (a Project's commands as "<key> · <line or not set>", in Settings every key as "<key> · in <Projects>"; "Choose a command…" while none is picked), with "Holds when it exits 0."
  - **Remove this test**.
- At each group's foot: **Add a test** (starts with "the previous Stage ended Done") and **Add a group** (combines the other way and starts with "the previous Stage ended Failed").
- A new condition starts as All of with the test "the previous Stage ended Done".
- An empty group shows "No test yet: add one, or remove this group." and is a problem that holds Save.
- A test's problem shows on its select; a group's under it.
- Words of a condition: tests joined by "and" or "or"; a nested group of two reads "both … and …" or "either … or …", of more "all of: …" or "any of: …".

## On failure

- Section **On failure** (only for an Agent Stage and a Script Stage): a select with **No loop** or **Go back to <Stage>**, offering only earlier Stages that work (never a Gate); "at most [stepper **Rounds**, 1 to 9] times, then as below" once a loop is set (a new loop starts at 2).
- A Stage that no longer qualifies stays listed with "(not earlier)" or "(gone)".
- Hint: "A loop, not a route: it runs only when <Stage> fails, going back before any route is weighed, and it is drawn apart from the routes, as a dashed red line." and, for the first Stage, "<Stage> is first, so it has nowhere earlier to go back to."
- The list "When <Stage> fails", in the order the walk takes:
  - "Back to <Stage> while it has rounds left: at most N times." or "No loop: nothing runs again by itself."
  - "Then the route to <target>, as its condition says <Stage> ended Failed." or "Then a route whose condition says <Stage> ended Failed: it has none."
  - "Then it is put to whoever holds Asked first when a Stage runs out of tries, then to you. Continuing with the issues follows its routes as usual."
- Pressing a loop's mark or a problem on it opens the Stage with this section marked and focuses its select.
- Deleting a Stage clears the loops that went back to it.

## Problems and warnings

- Below the panel, above the host's bar:
  - Problems (a warning alert titled "The Pipeline can't be saved yet", "These Stages can't be saved yet" for Edit for this Task, or "The Stage template can't be saved yet"): they hold Save. Each on a Stage is a link that picks where it is (a Stage, its On failure, a route, a test) and scrolls to the panel.
  - Warnings (an info alert "Worth a look, though it doesn't hold Save"), such as a Role nobody fills.
- Beside the service's check, the editor refuses on its own a condition group with no test: "Stage N · <name>: its route to <target> has a group with no test yet: add a test, or remove the group."
- What makes a flow unusable (a route leading back, a Stage no route reaches) is the service's check to say; an edit is never refused for it.

## Stage templates

- **Add a Stage** (Settings, Edit for this Task) is a menu "Add a Stage" with **Agent Stage**, **Script Stage**, **Gate**, then **From a template** listing the Stage templates by name (each with its kind icon); the same menu is under **Insert a Stage on this route**.
  - Disabled item when none: "No Stage template yet. Make one in Settings › Pipelines, or save a Stage as one."; a read error: "The Stage templates can't be read".
  - A new Stage: named "New Stage" (Agent Stage), "Script" or "Gate"; a name and key no other Stage has; added in a column of its own right after the picked Stage, a row below it, or after the last on row 0, with no routes (drawn after).
  - A template is added as a copy without its failure rule; it is copied, never linked.
- **Save as a template** (⋯ menu) saves the Stage without its failure rule, place and routes.
- Templates are made and edited in Settings › Pipelines ([settings.md](settings.md)).

## Locks

- Used by Edit for this Task: each Stage already started is locked, marked with its state ("Done", …) and a lock icon with "<state>: started, so it can't be changed".
- A locked Stage can't be dragged, moved, removed or drawn from; its panel's fields, Routes out and On failure are disabled, with that note as the tooltip, and the panel opens with a lock note.
- The columns up to the last holding a locked Stage are frozen: no Stage or column is made or closed up among them, and a Stage added goes after them.
- Routes into a locked Stage can be drawn and changed.
- What still breaks a lock (a Stage put straight after a started one) the service's check names.

## In a Project Pipeline

- The Stages shown are the ones the service built from the base Pipeline and the Stage changes; they keep the base Pipeline's places, so there is no dragging and no Move in the panel's menu or the List, but routes are drawn and removed.
- Marks on a Stage's left edge: green **Inserted after <Stage>** / **Inserted before <Stage>**, blue **Replaces <Stage>**, amber **Changed: <fields>** or **Routes changed** or **Changed: <fields>, and its routes**, and **Removed**; a plain Stage "From <base>". Routes into or out of an inserted Stage are green; of a Stage whose routes changed, amber.
- The head's menu: **Insert a Stage** (disabled, tooltip "Pick the Stage to insert after first") until a Stage is picked, then **Insert after <Stage>**: a menu with the kinds, **From a template**, and "Insert before <Stage>" items ("<kind> before <Stage>").
- Edits become Stage changes: a field edit a **Change** of only that field; a route edit a **Change routes**; an insert, replace and remove their own; edits made while the check is awaited wait.
- Above the head, when Stage changes don't apply: a group "N Stage changes don't apply to <base>" (or "N Stage change doesn't apply to <base>"); each item has its kind badge (Insert before, Insert after, Replace, Change, Remove, Change routes), the Stage it names (and the fields a Change gives), why, and its fix: **Apply it to** a select of the Stages ("Choose a Stage…"), or **Give <Stage> a key of its own** (an inserted or replacing Stage), or **Remove this Stage change**.
- Broken reasons on no Stage: the danger alert "These Stages can't run as they are".
- The panel, for a picked Stage:
  - **Undo** (tooltip and name by what it gives back: "Undo: take <Stage> out", "Undo: back to <base>'s <Stage>", "Undo: back to <base>'s <Stage> as it is", "Undo: put <base>'s <Stage> back").
  - The ⋯ menu on a Stage from the base Pipeline: **Replace <Stage> with** "A new Agent Stage", "A new Script Stage", "A new Gate", and **Remove from <Project>'s Stages**.
  - A note: for an inserted Stage the select **Where it goes** ("Before <Stage>" / "After <Stage>"; hint "Kept beside this Stage when <base> changes."); for a replaced one "Replaces <base>'s <Stage>, under its key, so the loops that go back to it still do. Undo puts it back."; for a base or changed one "From <base>: what you change here is a Change of only those fields, marked with <base>'s value. The rest follows <base>."
  - For a Changed Stage a table "What <Stage> changes": **Field**, **<base> has**, **<Project> gets**, and **Set back** per field ("Set <Field> back to <base>'s").
  - For a Stage whose routes changed: the routes side by side ("<base> has" / "<Project> gets", numbered "→ <target>, <when>") and the **Undo: give <Stage> <base>'s routes back** button ("Undo: give <Stage> its routes back" for an inserted Stage).
  - A removed Stage: only "Removed: <Project> doesn't get it. Each route that led into it leads where its one route out led. Undo puts <base>'s <Stage> back, in its place."
  - A Project Pipeline's Stage fields cover Name, Who works it (Role or duty), Project command, Publishes, After a conflict, Session, Budget, Effort, Context limits, Brief, Permissions and On failure.

## Proposal on the flow

- Shown with `?proposal=<id>` naming an open Proposal of a Pipeline's routes, instead of the form: in Settings › Pipelines for an office-wide Pipeline, in a Project's Pipelines section for a Project Pipeline.
- A banner (`role=status`) "<name>'s Proposal, shown on <Pipeline>: not applied yet": the sentences saying what each changed Stage's routes become, "Dashed lines are what it proposes; dotted ones, what it takes away. Nothing changes until you apply it."; actions **Apply change**, **Not now** (the Proposal is left) and, when the chat isn't beside, **Back to the Thread**; a refusal **The change can't be applied yet**.
- Toasts on apply: "<Pipeline> changed. Tasks that haven't started follow it." (office-wide) and "<Pipeline> saved. Tasks that haven't started follow it." (Project Pipeline).
- The editor is read-only: no menu, no +, no dragging, no keyboard edits.
- Each changed Stage keeps the routes it had; proposed routes are dashed, those taken away dotted.
- Picking a changed Stage shows its routes as Was and Proposed under the flow.
- A Proposal's warnings come from its routes' check.
- A Stage the Proposal removes isn't drawn on its flow, and neither are its routes.
- A Project Pipeline's flow is built by the service for the Proposal ("The Proposal can't be shown" on a refusal).

## Converted flow note

- On an office-wide Pipeline still reading as The Office's update converted it (each Stage in a column of its own on row 0, one route with no condition to the next, the last to End), an info alert "<name> is now drawn as a flow" with **Hide this note**.
- Text: "As The Office updated, every Pipeline became the same flow drawn as a straight line: its Stages in the same order, one route with no condition from each to the next and from the last to End, and each On failure loop as it was. Nothing else changed, and Tasks walk it as before."
- For each Stage that was optional: "<name> was optional: skipped when the Definition of Done was already met. That setting is now two routes out of <Stage>: to <name> when the Definition of Done has some not Reported met, otherwise straight to <onward or End>. It runs and passes by the same Stages as before."
- Hiding is this browser's (kept by the Pipeline's id), never sent to the service.

## States

- Loading: a host shows nothing until its Roles, duties and options are read (Project Pipelines) or shows its own errors.
- Waiting for the check: Save in the host is held while the service's answer is awaited; the Stages shown are the last answer's.
- Narrow window:
  - Canvas under 560px wide: "down" layout and its hint.
  - Settings and Project Pipelines show the list or the open one under 1224px ([project-page.md](project-page.md#pipelines)).
- Locked, removed and read-only forms are described above.

## Domain facts

- A Pipeline is a flow, its order, routes, conditions, On failure, validation: [2.3.2](../2.3.2-flows.md#a-pipeline-is-a-flow), [2.3.2](../2.3.2-flows.md#which-route-the-walk-follows), [2.3.2](../2.3.2-flows.md#built-in-conditions), [2.3.2](../2.3.2-flows.md#the-project-command-condition), [2.3.2](../2.3.2-flows.md#on-failure), [2.3.2](../2.3.2-flows.md#validation), [2.3.2](../2.3.2-flows.md#route-and-condition-proposals).
- Stage kinds and fields: [2.3.1](../2.3.1-stages.md#stage-kinds), [2.3.1](../2.3.1-stages.md#what-a-stage-declares).
- A Stage's effort in the model and effort cascade: [5.4.5](../5.4.5-engines-and-cascade.md#the-model-and-effort-cascade).
- Gates: [2.3.3](../2.3.3-gates-and-checks.md#gates).
- Publish Stage: [2.3.4](../2.3.4-publish.md#publish).
- The library editor, Stage templates, Project Pipelines, a Broken Project Pipeline: [2.3.5](../2.3.5-library.md#the-library-editor), [2.3.5](../2.3.5-library.md#stage-templates), [2.3.5](../2.3.5-library.md#project-pipelines), [2.3.5](../2.3.5-library.md#a-broken-project-pipeline).
