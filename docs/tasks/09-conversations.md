# 09 · Conversations and the Context policy: chat with the Planner

Status: todo

## Goal

The Conversations module: homes holding Threads, each backed by one engine session, with The Office's own message log as what the UI shows. The Context policy decides on every continuation whether to resume, start fresh with a Brief or hand off, shows why on the Thread with token counts, and lets the user override it. It is proven first in the chat modal: the user talks to the Planner about the Test Project, and the Planner reads but changes nothing.

## Definition of Done

- [ ] The chat modal opens over any page for a person with Chat on, with their Threads, a composer and "New thread"; a Thread's title comes from its first message and can be renamed; old Threads stay readable and can be continued. Check: Playwright on the Planner's chat.
- [ ] A chat session reads every Project's base branch, searches and fetches the web, and uses the Office tools that read records (Projects, People); it edits nothing and runs only read-only commands. Check: ask the Planner to read a file of the Test Project (works) and to change one (refused with the reason, shown on the Thread).
- [ ] Continuing a Thread resumes when the last call was under an hour ago or the context is under the threshold (30k to start, a setting), and otherwise starts fresh with a Brief; any change of person is a hand-off with a Brief. Check: unit tests of the policy with a fake clock, and a scripted-adapter test of each move.
- [ ] Every Thread shows the label with what and why ("Continuing · cache warm · 41k context"; "Fresh · cache expired, 48k context · brief ~3k") and its tokens; "Start fresh" and "Continue anyway" show their estimated cost, and the person's session default applies. Check: Playwright reads the label after each move.
- [ ] Near the context limit The Office asks for a Handover note, ends the session and starts fresh with a Brief; there is no automatic compaction. Check: a scripted-adapter test that crosses the limit.
- [ ] The Planner's person page lists their Threads under Conversations. Check: open it.
- [ ] A session's options come from the Role card version it recorded: a Role card change reaches only sessions started after it, and a resumed session keeps its version's options (task 08 checks the versions). Check: a test that starts a session, edits the card, and reads both sessions' options.

## Read first

- [Spec §2.4](../spec.md#24-conversations), [§2.5](../spec.md#25-context-policy), [§6](../spec.md#6-permissions-and-safety) (chats only read), [§9](../spec.md#9-defaults-chosen-in-this-spec) (renameable Thread titles).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §11.2 (resume vs fresh), §11.4.
- Reference, behaviour only: `D:\Projects\software-factory\apps\runner\src\claude\session-cache.ts`.
- Click-through: [app/chat.js](../../.scratch/the-office/prototypes/app/chat.js), [app/conversation.js](../../.scratch/the-office/prototypes/app/conversation.js).

Build from the chat modal and the conversation: the Thread list, the active Thread, messages, the composer, the context label and its overrides. Leave out: `@` mentions and link cards, the Office Manager's Proposals and redirects, Consultations.

## Steps

- [ ] 1. Conversations module domain and persistence: home (a person's chat, a Task), Thread (title, person, engine session id, state, tokens), messages in The Office's log (by the user, by the person, tool activity, refusals), rename, a fresh Thread; events and API. Commit.
- [ ] 2. The Context policy as a pure domain service: inputs (time since the last call, context size, the person's default, the moment's override, whether the person changes), the move with its reason, and the estimated cost of each alternative. Commit.
- [ ] 3. The Brief: assembled from the record with no model call, from parts other modules provide through a port (the person's card, the Project, later the Task's record and Handover notes). Before writing the chat case, settle with the user what a chat Thread's Brief holds when it continues fresh, since the spec only defines a Task's; propose the Thread's title, the Planner's latest Handover note asked for on near-limit, and the last few exchanges from The Office's log capped at about 3k tokens. Commit.
- [ ] 4. Running a Thread: the session built from the Role card (model, effort, instructions, skills folder, chat profile, Office tools), a read-only base checkout per Project for chat sessions, messages sent and streamed into the log, near-limit handling, tokens per Thread on metrics. Commit.
- [ ] 5. Office tools that read records: Projects and People, registered on the Engine's registry. Commit.
- [ ] 6. The chat modal in `apps/web`, opened from the person's card and page, and the Conversations tab on a person's page. Commit.
- [ ] 7. Check on the Test Project: a conversation with the Planner across a fresh Thread and a continued one; log the labels, tokens and the refused edit. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
