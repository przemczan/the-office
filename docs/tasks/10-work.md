# 10 · Work: Ideas, Tasks, the board and Attachments

Status: done

## Goal

The Work module and surface: Ideas captured in seconds from the top bar and shaped into Tasks; Tasks with their states, priority and manual order on a board by state; Attachments added by the user; and the Task page's record beside its conversation, ready for planning in task 11 and running in task 12. Chats gain the Office tools that read Work and capture Ideas.

## Definition of Done

- [x] "Idea" in the top bar captures an Idea (title, optional notes, Project or Office-wide) from any page in a few keystrokes. Check: Playwright captures one from Now and one from a Task page.
- [x] Shaping an Idea makes a Task in a chosen Project in Backlog, keeps the Idea as the Task's origin and moves its Attachments; dropping an Idea keeps it readable as dropped. Check: shape one, drop one.
- [x] The Task states and their rules hold: Backlog → Planning → Ready → In progress → Done, Waiting on you and Paused as side states, Dropped as the exit; Ready needs a Plan and a Definition of Done. Check: domain tests of every allowed and refused transition.
- [x] The board shows Tasks by state with their Project mark, priority (three levels) and manual order kept per Project; dragging reorders and the order survives a reload. Check: Playwright drags a card.
- [x] The user adds an Attachment (a Markdown document, an image, a file or a link) to an Idea or a Task; files live in the Office data directory with metadata in Postgres. Check: add one of each and open them.
- [x] The Task page shows the record (Definition of Done, Plan, Stages of its Pipeline, Attachments, the origin Idea) beside its conversation, with the Changes tab arriving in task 14. Check: open a Task.
- [x] In a chat, the Planner reads a Task or an Idea, captures an Idea and creates a Task in Backlog through the Office tools, and the person's page lists their Tasks under Work. Check: ask the Planner in chat on the Test Project.

## Read first

- [Spec §2.1](../spec/2.1-work.md), [§1](../spec/1-the-users-day.md), [§6](../spec/6-permissions-and-safety.md) (the chat's Office tools).
- Click-through: [app/work.js](../../.scratch/the-office/prototypes/app/work.js) (`board`, `boardCard`, `ideas`, `ideaCard`, `ideaToTask`), [app/task.js](../../.scratch/the-office/prototypes/app/task.js), the Idea capture in [app/core.js](../../.scratch/the-office/prototypes/app/core.js), the Work tab in [app/people.js](../../.scratch/the-office/prototypes/app/people.js).

Build from Work: the board, the Ideas list with shaping into a Task, the Task page record and conversation panel, Drop. Leave out: tags, filters and saved views, Initiatives and their graph, dependencies, moving a Task to another Project, archive, and the top bar's Project filter (one board holds every Project, each card with its mark).

## Steps

- [x] 1. Work module domain: Idea, Task (title, Project, state, priority, manual order, Plan, Definition of Done as a list of statements, origin Idea, its Pipeline by id; the Task's own Stages, once it starts or is edited for itself, are kept by Pipelines), Attachment, and the state machine with its rules and tests. Commit.
- [x] 2. Persistence, use cases, events and API: capture and shape Ideas, create, reorder, change priority, drop Tasks, add and remove Attachments (files stored under `<office-data>/attachments/`). Commit.
- [x] 3. The Work surface: the board, Ideas, the capture dialog from the top bar, and the Work blocks on the Project page and a person's page. Commit.
- [x] 4. The Task page: header with state, Project, Pipeline, priority and tokens; the record; the conversation panel from task 09 bound to the Task's home. Commit.
- [x] 5. Office tools for chats: read a Task or an Idea, capture an Idea, create a Task in Backlog. Commit.
- [x] 6. Check on the Test Project: capture an Idea, shape it into a Task, attach a document, reorder the board, ask the Planner in chat to create a second Task; log what was seen. Commit.

## Progress

The log is archived in [archive/10-work.md](archive/10-work.md).
