# 11 · Planning a Task with the Planner

Status: in progress

## Goal

Planning as a conversation: "Plan with *the Planner*" moves a Task to Planning and opens a planning Thread on it, in the Task's own worktree. The Planner reads the code, asks what it needs, and writes the Plan, the Definition of Done and a proposed Pipeline onto the record through Office tools; the user edits and confirms them and marks the Task Ready. Decisions are built here as a general mechanism: a Thread with a question, options and a recommendation, answered by an option, a free answer or follow-ups first.

## Definition of Done

- [ ] "Plan with *the Planner*" creates the Task's branch and worktree on the freshly fetched base branch, moves the Task to Planning and opens the planning Thread with a Brief of the Task (title, origin Idea and notes, Attachments, the Project's commands). Check: on the Test Project, open planning and read the Brief in the Thread's first session.
- [ ] The Planner writes the Plan and the Definition of Done onto the record and proposes a Pipeline (Full, Quick fix or Document) chosen from the Definition of Done; each shows as proposed until the user confirms or edits it, and confirming sets the Task's Pipeline (by id: Pipelines keeps a Task's own Stages, made when it starts or is edited for itself, as decided with the user in task 10). Check: a planning session on the Test Project ends with all three on the record.
- [ ] The Planner can open a Decision: it shows in the Thread with its options and recommendation, the user answers with an option or free text or asks follow-ups in the same Thread, and the Planner continues from the answer. The Task shows Waiting on you while it waits. Check: a scripted-adapter test of each answer kind, and one live Decision.
- [ ] "Mark Ready" is refused with the reason until a Plan and a Definition of Done are confirmed. Check: try it early.
- [ ] The Planner edits nothing in the worktree and runs only read-only git. Check: the planning Thread's log shows no edits; a test of the planning profile.

## Read first

- [Spec §2.1](../spec.md#21-work) (Plan, Definition of Done, states), [§2.3](../spec.md#23-pipelines) (the Planner proposes a Pipeline), [§2.4](../spec.md#24-conversations) (Decision), [§2.5](../spec.md#25-context-policy) (the Brief), [§6](../spec.md#6-permissions-and-safety) (the Planner's profile).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §2 (planning on the latest base), §11.7 (human decisions with free text).
- Click-through: planning and Mark Ready in [app/task.js](../../.scratch/the-office/prototypes/app/task.js) and [app/work.js](../../.scratch/the-office/prototypes/app/work.js); Decision messages in [app/conversation.js](../../.scratch/the-office/prototypes/app/conversation.js).
- Carried over from task 10:
  - Neither the board nor the Task page has "Plan with *the Planner*" yet; the Task page's conversation panel shows its empty state until the planning Thread exists, and its menu (`surfaces/work/task-menu.tsx`) holds only priority and Drop.
  - A person's Work tab (`surfaces/people/person-tasks.ts`) lists the Tasks they created and those whose Stages their Role works; the user also chose "Tasks with a Thread with them", deferred until Task Threads exist: step 4 adds it.
  - Moving a Task to Planning is `changeTaskState` in Work's domain (`task-states.ts`); Ready is refused there without a Plan and a Definition of Done.
- Decided with the user on 2026-10-25 (spec §2.4 and §9):
  - A Decision is a card in the asking Agent's Thread, not a Thread of its own; follow-ups are ordinary messages in that Thread, and the answer goes into the same session.
  - A Task in Planning with an open Decision stays in Planning and shows a Waiting on you badge, derived from its open Decisions; the state machine is unchanged.
  - "Plan as a Task with *the Planner*" on an Idea shapes it and opens planning at once, as the click-through does (`POST /api/ideas/:id/plan`); step 4 puts it on the Idea.
  - A Thread The Office opens is titled by it ("Planning"), shown with the person as "Planning · Jan" (spec §9).
  - Agents read a Task's Attachments through an Office tool, `read_attachment` (step 3).

## Steps

- [x] 1. Planning use case in Work: Backlog → Planning, the Task's branch and worktree through the Projects git service, the planning Thread with the Planner and its Brief parts from Work. Commit.
- [ ] 2. Decisions in the Conversations module: a Decision in the asking Agent's Thread (question, options, recommendation, context), its answer (option, free text), follow-ups as ordinary messages, and the Office tool "open a Decision" for Threads on a Task. The tool returns at once, telling the Agent to end its turn and wait; the answer is sent into the asking session as its next message, continued through the Context policy. No tool call blocks while the user decides. Answered Decisions join the planning Brief. Commit.
- [ ] 3. Office tools for planning: write the Plan, write the Definition of Done, propose a Pipeline; each lands on the record as proposed, with confirm and edit for the user. Also `read_attachment` for planning sessions, as the user chose: a document's text, a link's address, and an image or other file by its name and kind (a tool answers in text); the planning instructions and Brief say the Attachments can be read with it. Commit.
- [ ] 4. The Task page: "Plan with *the Planner*" on the board and the Task page, and "Plan as a Task with *the Planner*" on an Idea; the planning Thread, proposed and confirmed states on Plan, Definition of Done and Pipeline, the Decision card with its options and free answer, the Waiting on you badge, Mark Ready with its reason; Task Thread titles shown with the person, as "Planning · Jan"; "Tasks with a Thread with them" on a person's Work tab. Commit.
- [ ] 5. Check on the Test Project: plan a small real change with the Planner to Ready, with at least one Decision; log the tokens and the context labels. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
- 2026-10-25 · step 1: steps 1 and 2 swapped, since a Decision is answered in a Task Thread that can run, which needs the Task's worktree first. `POST /api/tasks/:id/planning` opens the Task's worktree (Projects' `TaskWorktrees.open`, no install) at the freshly fetched base, moves it to Planning and opens the planning Thread with the Planner (refused with the reason while nobody is the Planner, or when the worktree fails, leaving it in Backlog); `POST /api/ideas/:id/plan` shapes and plans. The Planner starts at once on The Office's opening (`ThreadRunner.open`, logged as its context line only). `ThreadRunner` now runs per home through `SessionPlaces`: a Task Thread works in the worktree with the Project's environment and skills, read-only, whatever the person's Chat is; Work gives its folder, tools, instructions and Brief through Conversations' `TaskThreadSetups`, a registry like the Office tools', since Work already calls Conversations. The Brief of a Task Thread is the record only, never its exchanges. Next: step 2, Decisions; for it: answered Decisions join the Brief in Conversations' `taskThreadBrief` (no port into Work), one read of open Decisions serves the board's badge and task 16's Needs you, `open_decision` is registered by Conversations and named in `PLANNING_OFFICE_TOOLS`, finds its Thread by session and refuses a chat, and the answer message carries the question with the chosen option's text or the free answer. Open with the user: the planning Thread is titled "Planning" by The Office (the click-through shows "Planning · Jan"), where spec §9 says titles come from the first message; and the Brief lists Attachments by name only, since no Office tool reads one's content.
- 2026-10-25 · answers: the user agreed that The Office titles the Threads it opens (spec §9), and chose a `read_attachment` Office tool, added to step 3 and the coverage table. Next: step 2, Decisions.
