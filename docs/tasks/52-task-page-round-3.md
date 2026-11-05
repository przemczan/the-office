# 52 · The Task page, round 3

Status: in progress

## Goal

Six of the user's notes on the page task 51 built:

- **The rail's loop-backs** stay tidy when the work goes back and forth a lot: several coming in to one Stage come in at the same spot, one above the other.
- **Editing a Plan or a Definition of Done** has a plain Save; Confirm stays a separate act.
- **Before Ready's** "Confirm it on the Plan" sits right after its line's words, not across a wide screen.
- **A Gate's Stage history** shows each round's Attachments in that round's details.
- **Tooltips** are never covered or clipped by what is around them.
- **Needs you on Now** shows the same cards as the Task page.

## Definition of Done

- [ ] Loop-backs into one Stage land at one spot, one above the other, and arcs that don't overlap share a height. Check: `stage-rail-words.test.ts`, and a screenshot of the rail fed the stages of Task 2a6dd41c, in both palettes.
- [ ] Save on the Plan and the Definition of Done doesn't confirm; the rules in [What was settled](#what-was-settled) hold. Check: `planning-changes.test.ts`, the Work controller's tests and a web test of the editor.
- [ ] A changing Save on a Ready Task sends it back to Backlog. Check: the same tests, and a queued Task's case.
- [ ] Before Ready's words follow their line at any width. Check: a screenshot at 1920px.
- [ ] A Gate's run shows its Attachments in its details. Check: a web test, with two runs of one Gate.
- [ ] Tooltips show over everything and stay in the window. Check: a `packages/ui` test, and screenshots of "tokens today" on Now and the status strip, and one inside a window.
- [ ] Now and the Needs you panel show the Task page's Decision and Gate cards, under the Task's title and Project. Check: the web tests and e2e of Now and the panel, and a screenshot of Now beside the Task page in both palettes.
- [ ] Spec 2.1 and 4, the glossary and the click-through say what was settled. Check: read each changed line against [What was settled](#what-was-settled).

## Read first

- [UI rules](../spec/4.1-ui-rules.md), before anything the user sees.
- `apps/web/src/surfaces/work/MAP.md`, and `apps/web/src/MAP.md` for the shell.

## What was settled

With the user, 2026-11-05.

**Save and Confirm**

- Editing has **Save** and Cancel. Save never confirms; Confirm is the only way to confirm.
- A Save that changes nothing changes nothing, the confirmation included.
- A changing Save leaves the part unconfirmed, in Backlog, Planning and Ready alike.
- A changing Save on a **Ready** Task sends it back: Ready needs both parts confirmed, so the Task leaves Ready for **Backlog**, and the user confirms and marks it Ready again. A Task queued to start leaves the queue with it.
- Saving a Plan or Definition of Done the user wrote while in Planning keeps the Task in Planning.
- Since the Planner may not be the author, an unconfirmed part's badge is the neutral **Not confirmed**, not "Proposed by the Planner".

**Needs you on Now**

- Now and the Needs you panel show the Task page's cards: a Gate with its question, facts line, Continue and Show details, Send back and Drop in the Gate window; Decisions as they read on the Task page.
- Now keeps the Task's title and Project chip above each card, as nothing around it says which Task it is.
- `GateCard` and `GateWindow` move from the Work surface to the shell, so both places use the same ones.

**Chosen while planning**

- A Gate run's Attachments are those added after the Gate's previous run ended (or from the start of the work, for its first run) until this run ended, or until now while it waits. A run can end in Continue, so the send-back rounds of `attachment-rounds.ts` are not enough here.
- Arcs get the lowest height free of the arcs they overlap, rather than one height each.
- The Tooltip moves from `design-system/` to `packages/ui/src/overlays.tsx`, as Dialog did, and draws on the body.

## Steps

- [x] 1. The small page fixes: the rail's loop-backs, Before Ready's line, a Gate run's Attachments, the Tooltip. Read: `stage-rail-words.ts`, `pipeline-rail.tsx`, `before-ready.tsx`, `run-details.tsx`, `gate-window.tsx`, `packages/ui/src/overlays.tsx`.
- [ ] 2. Save apart from Confirm, in the service and on the page, with the spec and the glossary. Read: `planning-changes.ts`, `planning-service.ts`, `task-states.ts`, `planning-parts.tsx`, spec 2.1.
- [ ] 3. Needs you on Now: the same cards, moved to the shell, with spec 4. Read: `needs-you-feed.tsx`, `gate-card.tsx`, `gate-window.tsx`, `needs-you-card.tsx`.
- [ ] 4. Close: the Definition of Done's checks, `npm run verify:linux`.

## State

Step 1 is built; the Definition of Done's boxes wait for step 4, though the checks of the rail, Before Ready, a Gate's run and the Tooltip passed here.

- **Rail:** `loopBacks` gives each arc the lowest height free of those it overlaps; a landing depends only on the Stage. Each arc draws its line across, and `loopBackEnds` one line and arrowhead per spot.
- **Gate run's Attachments:** `attachmentsOfGateRun` in `attachment-rounds.ts` is the one rule, used by `run-details.tsx` and by `picturesOfThisRound` for the run the Gate waits in. So the Gate's window no longer follows the send-back rounds; `attachmentRounds` still groups the Attachments tab. Trap: a Gate's run ends the moment the Task reaches it (`GATE_REACHED`) and the user's act has no time of its own, so "while it waits" is `gateAction === null`, and something added during a wait moves to the Gate's next run once the user acts.
- **Tooltip:** in `packages/ui/src/overlays.tsx`, placed by `tooltip-place.ts`, styled in `tooltip.css`, on the body at `--z-tooltip`. `design-system/` keeps its Tooltip, as it keeps Dialog: its bundle, card and UI kit use it, and that folder stays as exported.

For step 3: `gate-card.tsx`, `gate-window.tsx` and `gate-card-words.ts` still stand in `apps/web/src/surfaces/work/`; `picturesOfThisRound` takes the waiting Gate as its third argument. Step 2 changes the Proposed badge beside Confirm.

## Progress

- 2026-11-05 · step 1: the rail's loop-backs land on one spot at the lowest free height, Before Ready's words follow their line, a Gate's run shows its Attachments, and the Tooltip draws on the body from `packages/ui`; next, step 2: Save apart from Confirm.
