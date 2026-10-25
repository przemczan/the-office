# 09 · Conversations and the Context policy: chat with the Planner

Status: in progress

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

- [x] 1. Conversations module domain and persistence: home (a person's chat, a Task), Thread (title, person, engine session id, state, tokens), messages in The Office's log (by the user, by the person, tool activity, refusals), rename, a fresh Thread; events and API. Commit.
- [x] 2. The Context policy as a pure domain service: inputs (time since the last call, context size, the person's default, the moment's override, whether the person changes), the move with its reason, and the estimated cost of each alternative. Commit.
- [ ] 3. The Brief: assembled from the record with no model call, from parts other modules provide through a port (the person's card, the Project, later the Task's record and Handover notes). Before writing the chat case, settle with the user what a chat Thread's Brief holds when it continues fresh, since the spec only defines a Task's; propose the Thread's title, the Planner's latest Handover note asked for on near-limit, and the last few exchanges from The Office's log capped at about 3k tokens. Commit.
- [ ] 4. Running a Thread: the session built from the Role card (model, effort, instructions, skills folder, chat profile, Office tools), a read-only base checkout per Project for chat sessions, messages sent and streamed into the log, near-limit handling, tokens per Thread on metrics. Commit.
- [ ] 5. Office tools that read records: Projects and People, registered on the Engine's registry. Commit.
- [ ] 6. The chat modal in `apps/web`, opened from the person's card and page, and the Conversations tab on a person's page. Commit.
- [ ] 7. Check on the Test Project: a conversation with the Planner across a fresh Thread and a continued one; log the labels, tokens and the refused edit. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->

- 2026-10-25 · step 1: `ConversationsModule` (imports People): a `Thread` in a `Home` (`chat` by Role key; `task` by Task id, in the domain only until task 10) with the person's Role key, a title, a state, its four-part token totals and the engine session behind it now (`ThreadSession`: id, Role key, card version, started, last call, context tokens), kept as one jsonb on the Thread: only that session can be resumed, so starting fresh replaces it and step 4 calls Skills' `SessionSkills.forget` on the old one (its folder's cleanup needs no list of past sessions). The Office's log is `thread_messages` (append-only, a `position` to order it, the message's kind and fields as jsonb), with four kinds: `user`, `person`, `tool-activity` (tool and a one-line summary) and `refusal` (tool and reason); the engine's text arrives as whole blocks, so a message is written once. Rules: a chat Thread starts untitled and `waiting`, refused when the person's Chat is off (their Threads stay listed and readable); the title comes from the user's first message as the click-through cuts it (34 characters, cut at a word at 32 with …) and a rename (trimmed, 1–80 characters) survives it. Migration `0009_threads`. API: `GET`/`POST /chats/:roleKey/threads` (newest started first; a fresh Thread), `GET /threads/:id`, `PUT /threads/:id/title`, `GET /threads/:id/messages`; web events `thread.started`, `thread.renamed`, `thread.messages-logged`, each with the Thread and its home. `RoleCards.find` (People) answers the current card or nothing, as `RoleNotFound` stays inside People. To confirm with the user when step 6 shows them: the state words `waiting` and `answering`. For step 4: refuse continuing a Thread whose person's Chat is off. Surprise: `shell-command-runner.test.ts` failed twice under the fuller run with EBUSY removing its temp folder (Windows holds it a moment after the ended processes), so its cleanup retries as the git adapter does. Next: step 2, the Context policy.
- 2026-10-25 · step 2 (before): asked the user, now in spec §9: a person's session default decides only the cold case (warm within an hour of the last call always continues; once cold, Context policy goes by the 30k threshold, Always start fresh starts fresh, Prefer to continue continues; the moment's override wins; a change of person is a hand-off), and every layer calls it the session default, so the Role card's "Sessions" label became "Session default" and its choices' descriptions say when they apply. Next: step 2.
- 2026-10-25 · step 2: `domain/context-policy.ts`: `decideContext(continuation, settings)`, pure, `now` given. Moves `resume`, `fresh`, `hand-off` (spec §2.5's words), each with its reason: `new-thread`, `another-person`, `cache-warm`, `small-context`, `cache-expired`, `session-default`, `your-choice`; whether the cache is warm, the context size, the Brief's estimate when one is needed, and the one alternative the moment offers ("Start fresh" at the Brief's tokens after a resume, "Continue anyway" at the context's tokens after a fresh start; none for a new Thread or a hand-off, and an override never continues another person's session). Settings: an hour's cache and 30k (`DEFAULT_CONTEXT_POLICY_SETTINGS`), passed in so step 4 can read the threshold from configuration until task 17's Settings holds it. Conversations keeps its own `SessionDefault` type, mapped from the Role card. The label's words ("Continuing · cache warm · 41k context") are the web's, built from the decision in step 6. Next: step 3, the Brief, which starts by asking the user what a chat Thread's Brief holds.
