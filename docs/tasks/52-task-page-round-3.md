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

- [ ] 1. The small page fixes: the rail's loop-backs, Before Ready's line, a Gate run's Attachments, the Tooltip. Read: `stage-rail-words.ts`, `pipeline-rail.tsx`, `before-ready.tsx`, `run-details.tsx`, `gate-window.tsx`, `packages/ui/src/overlays.tsx`.
- [ ] 2. Save apart from Confirm, in the service and on the page, with the spec and the glossary. Read: `planning-changes.ts`, `planning-service.ts`, `task-states.ts`, `planning-parts.tsx`, spec 2.1.
- [ ] 3. Needs you on Now: the same cards, moved to the shell, with spec 4. Read: `needs-you-feed.tsx`, `gate-card.tsx`, `gate-window.tsx`, `needs-you-card.tsx`.
- [ ] 4. Close: the Definition of Done's checks, `npm run verify:linux`.

## State

Nothing built yet. The stages of Task 2a6dd41c, from the running Office, show the rail's fault: five loop-backs get five levels, and `loopBackPath` moves each landing by its level, so two arcs into one Stage land apart.

## Progress
