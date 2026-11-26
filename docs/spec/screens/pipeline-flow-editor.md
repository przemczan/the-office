# Pipeline flow editor

Covers: the Pipeline flow editor shared by Settings › Pipelines, a Project's Project Pipelines and a Task's "Edit for this Task" (head, the Route drawing switch, Auto-align and its Undo, legend, the canvas, route drawing and the limit marks, moving a Stage and snapping, moving a Stage in the order, the narrow view, moving and zooming, full screen, the hint, the Stage panel, the linked-template line, Routes out and the route forms, the route panel, the condition builder, the check's problems and warnings, Stage templates, locks), the Proposal on the flow, the moved-flow note.

## Where it is

- It is a block, not a page. Hosts:
  - **Settings › Pipelines** (`/settings/pipelines/$pipelineId`): an office-wide Pipeline, inside the library form's card ([settings.md](settings.md#pipelines)).
  - **A Project's Pipelines** (`/projects/$projectId/pipelines/$projectPipelineId`): a Project Pipeline, inside the form's card ([project-page.md](project-page.md#the-open-project-pipeline)).
  - **Edit for this Task**: the Task's own Stages ([task-page.md](task-page.md)).
  - **A Proposal on the flow**: read-only, under the Proposal's banner ([Proposal on the flow](#proposal-on-the-flow)).
- An office-wide Pipeline and a Project Pipeline get the same editor, with everything in it: dragging, moving, drawing and removing.
- Each host keeps the Stages and applies every edit; the editor keeps only what is picked and the hint.

## Layout

- The head: title and summary, the **Route drawing** switch, **Auto-align**, the host's menu (Add a Stage).
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
- The **Route drawing** switch, a small segmented control named "Route drawing" after the title and before Auto-align ([Route drawing](#route-drawing)).
  - Its choices: **Right angles** (tooltip "Around Stages, lines side by side kept apart"), **Curves** ("One smooth curve per route") and **Straight lines** ("The direct line from Stage to Stage").
  - Shown in every host, read-only flows and a Proposal on the flow included.
  - Under 560px it wraps under the title.
- **Auto-align**, a secondary button before the host's menu ([Auto-align](#auto-align)).
- The host's menu **Add a Stage**: **Agent Stage**, **Script Stage**, **Gate**, **Publish Stage**, then **From a template** ([Stage templates](#stage-templates)).
- The host's menu is hidden on a read-only flow.

## Legend

- A list named "What the lines mean": a line sample **Route**, and the limit mark **≤N×** "at most N times".
- A Proposal on the flow: its own legend, naming the one who drafted it.

## Hint

- A line with an info icon under the legend (`role=status`); it says how to use the editor, and after an edit says what the edit did, until the next pick.
- How to use it, wide: "Drag a Stage anywhere: it snaps to the grid and to other Stages; hold Alt (⌥) to place it freely, Shift to keep it in line. Drag from its + to any Stage, itself or an earlier one too, or to End, to draw a route; pick a route to set its condition and its limit. Auto-align lays out the whole Pipeline. Without a mouse: Tab to a Stage, Shift + arrows move it, Enter opens it below. Drag the canvas with the right mouse button to move around; Ctrl/⌘ + scroll zooms, and F fits the whole Pipeline."
- How to use it, narrow (canvas under 560px wide): "Press a Stage or a route to edit it below. The Pipeline reads top to bottom here, as its Stages stand from left to right on a wider screen. Move and Routes out do everything without dragging; drag from a Stage's + to draw a route."
- Read-only: "Pick a Stage or a route to read it below. Drag the canvas with the right mouse button to move around; Ctrl/⌘ + scroll zooms, and F fits the whole Pipeline."
- What an edit says:
  - Stage added: "<name> was added after <Stage> in the Pipeline's order (or: as the last Stage), beside it on the canvas. Drag it where it goes, then draw its routes: drag from a Stage's + to another Stage or to End. Without dragging: Move and Routes out, below."
  - Dropped clear of a card: "<name> was put beside <Stage>, so it doesn't cover it."
  - Moved earlier or later: "<name> is now N of M in the Pipeline's order; it stays where it is on the canvas.", then for each route that changed "The route from <Stage> to <target> now leads back." or "… now leads on.", and when the first Stage changed "Walks now start at <name>."
  - Auto-align done: "Auto-align laid out the N Stages from left to right in the Pipeline's order." with **Undo** ([Auto-align](#auto-align)).
  - Undo: "The Stages are back where they were before Auto-align."
  - Auto-align failed: "Auto-align couldn't load its layout code, so nothing moved. Check the connection, then press Auto-align again."
  - Stage removed: "<name> was removed. Each route that led into it now leads where its one route out led, so a straight line stays one."
  - Stage put on a route: "<name> was put on the route from <Stage>: that route now leads to it, its condition and limit kept, and one route with no condition leads on from it."
  - Route removed: "The route from <Stage> to <target> was removed."
  - Route drawn: "Route drawn from <Stage> to <target>." and, when the Stage has other routes, " As <Stage> has other routes out, set when it is followed, below."
  - Route back drawn: "Route drawn from <Stage> back to <target>, at most 3 times: set its condition and its limit below."
  - Route already there: "<Stage> already has a route to <target>: it is picked below. Two cases that lead there are one route whose condition joins them with Any of."

## Flow view (the canvas)

- A region named "Flow": the Stages where each stands, by its [position](../2.3.2-flows.md#a-stages-position), **End** where it stands or, without a position, 76 right of the right-most Stage, level with the first final Stage, and the routes drawn over them in one SVG.
- The canvas is the box around all Stages and End with its own margin: a Stage moved past its left or top edge grows it, and the view moves to keep everything in place.
- Where a Stage stands never changes the Pipeline's order ([Moving a Stage in the order](#moving-a-stage-in-the-order)); a route on may point left where its Stages are placed so.
- Under 560px wide ("down"), the [narrow view](#narrow-view) draws the Stages in bands from top to bottom.
- A line marks where the walk starts: a dot and an arrow into the first Stage.
- **Stage card**:
  - A button named by the Stage, with a kind icon (Agent Stage, Script Stage, Gate, Publish Stage) and its name.
  - Its second line: for an Agent Stage who works it, a Role's name or "<duty label> · <holder>" ("nobody yet" for one naming nobody); for a Script Stage its command by its name; for a Gate "waits for you"; for a Publish Stage "publishes by <mode>" or "pushes the branch only".
  - A flag icon on a Stage with problems (its words as the tooltip), a red outline.
  - On a started Stage, a lock ([Locks](#locks)).
  - A **+** handle named "Draw a route from <Stage>" (hidden on a read-only flow and on locked Stages).
  - Pressing the card picks the Stage.
- **Route rows**: a Stage with several routes, or one with a condition or a limit, lists them inside its card, each row "→ <target> <when> ≤N×".
  - A row shows its port dot only when its line leaves from it ([Route drawing](#route-drawing)).
  - The when: "when it fails", "if the Agent chooses: <words>", "when <condition in words>", "when it ends Conflict" (a Publish Stage's results, joined by "or"), "otherwise", "always".
  - The mark ≤N× only on a route with a limit.
  - A Stage with one route, with no condition and No limit, lists none, and the line leaves its edge.
  - A row or line named "Route from <Stage> to <target>" (", at most N times" on one with a limit); pressing picks the route; a route with no row is reached by Tab on its line.
  - A card with only routes that have conditions shows "When none holds, you're asked" (a warning icon; its tooltip the check's warnings).
  - A picked route is highlighted; a route with a problem is red.
- **Routes back** are drawn as ordinary solid routes, by the same rules as routes on ([Route drawing](#route-drawing)).
- A press on a route's ≤N× mark on its line picks the route, as its line and its row do.
- **Keyboard**:
  - Arrows (Left/Right/Up/Down across; Up/Down for the order and Left/Right within a band when narrow) pick the previous or next Stage in the Pipeline's order.
  - Shift + an arrow moves the focused Stage one grid step, 16, past any card in the way (focus stays on it).
  - Delete or Backspace on a route's line, or with a route picked, removes it.

## Route drawing

- How the routes are drawn is this browser's choice, from the [Route drawing](#head) switch: **Right angles** (the default), **Curves** or **Straight lines**.
- Kept in this browser's local storage (`the-office.flow-route-drawing`), never sent to the service; every flow on the page and in the browser's other tabs follows a change at once.
- A stored value that isn't one of the three counts as Right angles.
- Right angles is the default: it alone keeps lines apart in a shared corridor, it draws the test Pipelines with no crossing, its lines leave from their own rows so a row and its line read as one, its marks sit on level stretches, and it is closest to what Auto-align lays out.
- Switching redraws the lines only: no Stage moves, nothing is saved, and what is picked stays.
- The Proposal card's small drawing of route changes follows the choice and has no switch of its own.
- The Task page's Pipeline diagram draws with the same choice ([task-page.md](task-page.md#pipeline-diagram)).

### In every mode

- Routes on and routes back are drawn together in one pass by the same rules; a limit only adds its ≤N× mark.
- No line runs through a Stage card or End.
- The arrow is on the target's edge, pointing in.
- A route to its own Stage is a loop, 56 wide and 24 out, on the Stage's top edge (left edge, narrow), or its bottom edge (right edge, narrow) when another card stands less than 40 over that edge.
- Lines carry no words, only a route's ≤N× mark; a route's words are its row in the card.
- The start marker keeps its place, the middle of the first Stage's left edge (top edge, narrow).
- The same Pipeline draws the same way every time; Stages never move for a line.
- All lines are in one layer under the cards, in the Pipeline's order; only the picked route is raised.

### Right angles

- Level and upright stretches with corners rounded by 6, going around Stages.
- The sides: to a Stage ahead the line leaves the right edge at its route's row and enters the left edge; to one clearly above or below, the facing edges; otherwise (behind, or close on every side) the top edges, or the bottom edges where fewer cards stand over the span there.
- Wide, a line never leaves a left edge and never enters a right edge.
- Several lines on one side stand 16 apart round its middle, in the order of where their other ends stand, 12 clear of the corners (never under 8 on a crowded side); beside a line with a ≤N× mark they stand 24 apart where the side has room, so the mark fits by its neighbour.
- Each line takes the cheapest way over tracks along the cards and down the middle of the gaps: its length, plus 48 a bend, plus 192 a crossing; the shortest lines go first.
- Lines that share a corridor stand 16 apart (24 beside a stretch with a mark), never under 6, nested so they don't cross where they part; lines cross only at right angles and never share a stretch.
- The mark sits on the longest level stretch with room, else an upright one, else nowhere on the line.

### Curves

- One smooth curve per route, using the sides and points of Right angles, leaving and entering square to the edge.
- Between facing sides each end reaches half the gap between the edges (at least 24); back over one side the arc reaches 0.3 of the distance between its ends (40 to 160; 64 narrow), so longer arcs nest over shorter ones.
- A curve that would pass within 8 of a card goes round through the corners of the cards grown by 16, as one smooth curve; with no room, it falls back to straight stretches with corners rounded by 12.
- Curves may run close to each other but never share an end point.
- The mark sits at the middle of the curve, slid along it to the nearest free spot.

### Straight lines

- The direct line from card centre to card centre, cut at their edges: the plainest picture of what leads where, and the one that crosses most.
- No line leaves from a row, so no row shows a port dot.
- A pair of lines between two Stages each move 8 to their own right (12 when one carries its mark on a steep stretch).
- A line that would pass within 8 of a card bends sharply round the corners of the cards grown by 16; a clear line never bends to dodge a crossing.
- A route to its own Stage is the same loop with sharp corners.
- The mark sits at the middle of the longest stretch, slid to the nearest free spot.

### Marks and ports

- A ≤N× mark, 40 × 18, sits on its own line with 4 clear of every card, every other line and every other mark; a line with no room draws none, and its row still shows ≤N×.
- A press on a mark picks its route; the mark is no Tab stop and is hidden from screen readers, as its row or line names the limit.
- Each line keeps its 12-wide hit line along its path in every mode.
- A row shows its port dot only when its line leaves from it; none in Straight lines or the narrow view.
- The picked route is highlighted on its line, its mark and its row together.

### Proposals

- A Proposal's proposed and taken-away lines are drawn by the same rules as any line, in every mode: proposed dashed in the accent colour, taken away dotted.
- The line drawn while dragging from a Stage's + is a straight dashed line in every mode; dropped, it takes its mode's shape.

### Performance

- The lines are drawn on the main thread, at once with the cards; panning, zooming and picking redraw nothing.
- Curves and Straight lines always draw in full.
- Right angles draws in full on every frame up to 8 Stages and 16 lines; over that, while a Stage is dragged, only the lines of the moved Stage and those its card now blocks are routed again, and the drop draws in full.
- The budget: at most 4 ms of a frame for the lines while a Stage is dragged.

## Moving a Stage

- On the wide canvas, a Stage that can be moved is dragged anywhere; it moves only its position, never the Pipeline's order.
- A drag starts after 5px of movement; a press without it picks the Stage.
- **Snapping**: each axis on its own, to the nearest line of another Stage or End within 8 screen pixels, else to a 16-unit grid.
  - On x the dragged card's left edge, centre and right edge, against the same lines of every other Stage and End; on y its top, centre and bottom.
  - The grid's dots show only while a Stage is dragged.
- **Guides**: a dashed line through the matched edge or centre, from the dragged card to each Stage it lines up with, a dot at each end; one per axis at most, gone on drop.
- Alt (⌥ on a Mac) while dragging places it freely: no grid, no guides, whole units only.
- Shift while dragging keeps it on its line, across or down, whichever way it has moved further.
- **A drop never covers a card**: a Stage that would come within 16 of another card lands on the nearest free grid spot, outlined while dragging, and the hint says so.
- Dragging from a Stage's + to any Stage, its own included, or to End draws a route; **End** lights up as a target.
- End is dragged like a Stage, which gives it a position of its own.
- A touch that becomes a scroll cancels and drops nothing.
- A started Stage is moved like any: positions are never locked ([Locks](#locks)).
- There are no drop cells: a drop makes no column and puts no Stage below another.

## Moving a Stage in the order

- **Move <Stage> earlier** and **later** in the [Stage panel](#stage-panel) swap it with the Stage before or after it in the Pipeline's order; it stays where it is on the canvas.
- Tooltip: "Earlier in the Pipeline's order; it stays where it is on the canvas" (later likewise).
- Disabled with "<Stage> is already first", "<Stage> is already last", or, on a started Stage, "Started, so it keeps its place in the order".
- Moving a Stage in the order may turn a route on into a route back, or back, and may change the first Stage; its limit stays as it is, and the check says when a loop is left with none.
- Dragging, Shift + arrows, Auto-align and Undo never change the order.

## Auto-align

- **Auto-align** in the head lays out the whole Pipeline as a layered diagram from left to right in the Pipeline's order: routes on lead to later layers, the first Stage stands first and End last; the lines are then drawn by the [Route drawing](#route-drawing) chosen.
- Tooltip: "Lay out the whole Pipeline from left to right in its order".
- Not shown on a read-only flow or under 560px; disabled with "Add a Stage first" on a Pipeline with no Stage.
- On first use it loads its layout code, reading "Laying out…" meanwhile.
- It moves every Stage, started ones too, and End, and changes no field, route, limit or the order.
- The cards glide to where they now stand (none with reduced motion), and the view fits the Pipeline.
- The same Stages, sizes and order always give the same layout.
- It is one edit in the draft: **Undo** in the hint, or Ctrl/⌘ + Z while focus is in the editor, puts every Stage and End back exactly; the next edit of any kind takes the Undo away.
- Save saves the Stages as shown.

## Narrow view

- Under 560px wide, the Stages are drawn in bands from top to bottom, made from their positions; nothing is stored.
- Going through the Stages from left to right, a Stage joins the band before when its card overlaps it by at least half a card, and starts a new band otherwise.
- Within a band Stages sit side by side, the highest first, at most 2 to a line.
- End stands last, in a band of its own; the start marker comes down into the first Stage.
- Every way of [Route drawing](#route-drawing) draws there, by its own rules with left-to-right and top-to-bottom swapped.
  - Right angles and Curves: a line to a Stage below leaves the bottom edge and enters the top edge; to a Stage in another column, beside it or higher up, the facing edges; a route back up the same column leaves and enters the left edges and runs beside the Stages.
  - Straight lines: centre to centre, as wide.
- Two Stages in a band stand 24 apart, so a line and its arrow fit between them; a mark doesn't fit there, so such a line leaves its ≤N× to its row.
- Cards show no port dots.
- Dragging a Stage, Shift + arrows and Auto-align are off; Move earlier, Move later, Routes out and drawing from the + work.

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
- Tools: **Move <Stage> earlier** and **later** (chevrons; [Moving a Stage in the order](#moving-a-stage-in-the-order)), then a ⋯ menu "More for <Stage>":
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
  - Inserting: the route leads to the new Stage, its condition and limit kept; one route with no condition leads from it to the old target, with the default limit for where it leads; it goes right after the route's Stage in the order, beside it on the canvas.
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
  - A new Stage: named "New Stage" (Agent Stage), "Script", "Gate" or "Publish"; a name and key no other Stage has; added right after the picked Stage in the Pipeline's order, or last when none is picked (in a Task's own Stages, after the last started Stage), with no routes (drawn after).
  - It stands 76 right of the Stage before it in the order, at that Stage's y, moved down by 16 until it covers no card ([A Stage's position](../2.3.2-flows.md#a-stages-position)).
  - A new Publish Stage publishes by the Project's publishing mode.
- A template added to a Pipeline's Stages, office-wide or a Project's, is linked to it ([Linked-template line](#linked-template-line)); added to a Task's own Stages, it is a copy.
- **Save as a template** (⋯ menu) saves the Stage without its key, position and routes; in a Pipeline the Stage is then linked to the new template.
- Templates are made, edited and removed in Settings › Pipelines, which lists their linked Stages and asks which get an edit ([settings.md](settings.md#pipelines)).

## Locks

- Used by Edit for this Task: each Stage already started is locked, marked with its state ("Done", …) and a lock icon with "<state>: started, so it can't be changed".
- A locked Stage can't be moved in the order, removed or drawn from; its panel's fields and Routes out (where each leads, its condition, its limit and their order) are disabled, with that note as the tooltip, and the panel opens with a lock note.
- The Pipeline's order is frozen up to the last started Stage: no Stage is added among those Stages or moved earlier into them, and a Stage added goes after them.
- Positions are never locked: a started Stage can be dragged and Auto-align moves it.
- Routes into a locked Stage can be drawn and changed, routes back included.
- What still breaks a lock (a Stage put among the started ones, or one moved earlier into them) the service's check names.

## Proposal on the flow

- Shown with `?proposal=<id>` naming an open Proposal of a Pipeline's routes, instead of the form: in Settings › Pipelines for an office-wide Pipeline, in a Project's Pipelines section for a Project Pipeline.
- A banner (`role=status`) "<name>'s Proposal, shown on <Pipeline>: not applied yet": the sentences saying what each changed Stage's routes become, with their limits, "Dashed lines are what it proposes; dotted ones, what it takes away. Nothing changes until you apply it."; actions **Apply change**, **Not now** (the Proposal is left) and, when the chat isn't beside, **Back to the Thread**; a refusal **The change can't be applied yet**.
- Its lines follow the browser's [Route drawing](#route-drawing), and the switch stays in the head.
- Toasts on apply: "<Pipeline> changed. Tasks that haven't started follow it." (office-wide) and "<Pipeline> saved. Tasks that haven't started follow it." (Project Pipeline).
- The editor is read-only: no menu, no Auto-align, no +, no dragging, no keyboard edits.
- Each changed Stage keeps the routes it had; proposed routes are dashed, those taken away dotted.
- Picking a changed Stage shows its routes, each with its limit, as Was and Proposed under the flow.
- A Proposal's warnings come from its routes' check.
- A Stage the Proposal removes isn't drawn on its flow, and neither are its routes.
- The Stages stand where the Proposal puts them; a Stage it adds without a position stands where [A Stage's position](../2.3.2-flows.md#a-stages-position) puts it.
- When it changes the order, the banner adds "It changes the Pipeline's order to <Stages in order>."; when it moves Stages, "It also moves N Stages on the canvas, which doesn't change how the Pipeline runs."
- Positions changed since it was made don't make it stale; **Apply change** keeps where the Stages it doesn't move stand now ([2.3.5 Proposals](../2.3.5-library.md#proposals)).

## Moved-flow note

- On a Pipeline The Office moved to routes back and Publish Stages ([2.3.5](../2.3.5-library.md#the-move-to-routes-back-and-publish-stages)), office-wide or a Project's, an info alert "<name> now goes back by routes" with **Hide this note**.
- Text: "As The Office updated, each On failure setting became a route back with the same limit, Publish became a Publish Stage, and a conflict at Publish now goes by the conflict chain drawn in: Resolve, Test after Resolve, then Publish again. Tasks walk it as before."
- Hiding is this browser's (kept by the Pipeline's id), never sent to the service.

## States

- Loading: a host shows nothing until its Roles, duties and options are read (Project Pipelines) or shows its own errors.
- Waiting for the check: Save in the host is held while the service's answer is awaited; the Stages shown are the last answer's.
- Narrow window:
  - Canvas under 560px wide: the bands made from positions ([Narrow view](#narrow-view)) and its hint.
  - Settings and Project Pipelines show the list or the open one under 1224px ([project-page.md](project-page.md#pipelines)).
- Locked and read-only forms are described above.

## Domain facts

- A Pipeline is a flow, routes and their limits, the Pipeline's order, a Stage's position, the route forms: [2.3.2](../2.3.2-flows.md#a-pipeline-is-a-flow), [2.3.2](../2.3.2-flows.md#a-routes-limit), [2.3.2](../2.3.2-flows.md#the-pipelines-order), [2.3.2](../2.3.2-flows.md#a-stages-position), [2.3.2](../2.3.2-flows.md#which-route-the-walk-follows), [2.3.2](../2.3.2-flows.md#the-route-forms).
- An Agent's choice, conditions, a limit running out, validation, Proposals: [2.3.2](../2.3.2-flows.md#how-an-agent-chooses-its-route), [2.3.2](../2.3.2-flows.md#built-in-conditions), [2.3.2](../2.3.2-flows.md#the-project-command-condition), [2.3.2](../2.3.2-flows.md#when-a-limit-runs-out), [2.3.2](../2.3.2-flows.md#validation), [2.3.2](../2.3.2-flows.md#route-and-condition-proposals).
- Stage kinds and fields, a linked Stage, merging the base first: [2.3.1](../2.3.1-stages.md#stage-kinds), [2.3.1](../2.3.1-stages.md#what-a-stage-declares), [2.3.1](../2.3.1-stages.md#a-stage-linked-to-its-stage-template), [2.3.1](../2.3.1-stages.md#an-agent-stage-may-merge-the-base-first).
- A Stage's effort in the model and effort cascade: [5.4.5](../5.4.5-engines-and-cascade.md#the-model-and-effort-cascade).
- Gates: [2.3.3](../2.3.3-gates-and-checks.md#gates).
- The Publish Stage, its results, the conflict chain and Resolve: [2.3.4](../2.3.4-publish.md#publish), [2.3.4](../2.3.4-publish.md#publishs-results), [2.3.4](../2.3.4-publish.md#conflicts-in-the-flow), [2.3.4](../2.3.4-publish.md#the-resolve-stage).
- The library editor, Stage templates and their linked Stages, Project Pipelines, Proposals' positions, the moves: [2.3.5](../2.3.5-library.md#the-library-editor), [2.3.5](../2.3.5-library.md#proposals), [2.3.5](../2.3.5-library.md#the-move-to-positions), [2.3.5](../2.3.5-library.md#stage-templates), [2.3.5](../2.3.5-library.md#editing-a-template-with-linked-stages), [2.3.5](../2.3.5-library.md#project-pipelines), [2.3.5](../2.3.5-library.md#the-move-to-routes-back-and-publish-stages).
