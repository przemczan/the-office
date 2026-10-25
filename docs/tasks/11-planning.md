# 11 · Planning a Task with the Planner

Status: todo

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
  - In the click-through, "Plan as a Task with Jan" on an Idea shapes it and opens planning at once; task 10's "Shape into a Task" only makes the Backlog Task. Ask the user whether shaping goes on into planning here.
  - A person's Work tab (`surfaces/people/person-tasks.ts`) lists the Tasks they created and those whose Stages their Role works; the user also chose "Tasks with a Thread with them", deferred until Task Threads exist: add it with the planning Thread.
  - Moving a Task to Planning is `changeTaskState` in Work's domain (`task-states.ts`); Ready is refused there without a Plan and a Definition of Done.

## Steps

- [ ] 1. Decisions in the Conversations module: a Decision Thread on a home (question, options, recommendation, context), its answer (option, free text), follow-ups, and the Office tool "open a Decision". The tool returns at once, telling the Agent to end its turn and wait; the answer is sent into the asking session as its next message, continued through the Context policy. No tool call blocks while the user decides. Commit.
- [ ] 2. Planning use case in Work: Backlog → Planning, the Task's branch and worktree through the Projects git service, the planning Thread with the Planner and its Brief parts from Work. Commit.
- [ ] 3. Office tools for planning: write the Plan, write the Definition of Done, propose a Pipeline; each lands on the record as proposed, with confirm and edit for the user. Commit.
- [ ] 4. The Task page: the planning Thread, proposed and confirmed states on Plan, Definition of Done and Pipeline, the Decision card with its options and free answer, Mark Ready with its reason. Commit.
- [ ] 5. Check on the Test Project: plan a small real change with the Planner to Ready, with at least one Decision; log the tokens and the context labels. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
