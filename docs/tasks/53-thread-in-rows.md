# 53 · The Thread in Rows

Status: done

## Goal

Every Thread reads like a team channel, as drawn in the Rows design of [docs/design/thread-dialog.html](../design/thread-dialog.html): each turn has an avatar, a name and a time, on the left, for the user and the person alike. Decisions, Handover notes and the other cards stay as they are.

The user can always read a tool call's whole command, however narrow the window. Today a long one is cut in two places: the page clips it to one line with no way to open it, and the service stores only its first 200 characters.

## Definition of Done

- [x] A tool call keeps its whole text, line breaks included. Check: `tool-activity.test.ts`, with a command over 200 characters and one of several lines.
- [x] Every command shows whole at any width: it wraps, and only a very long one scrolls in its place. The line beside "is working" wraps too. Check: a web test, and a screenshot at 380px of a command over 200 characters.
- [x] A turn has its avatar, name and time on the left; the user's avatar is neutral. Neighbouring messages still join into one turn. Check: `message-list-kinds.test.tsx`.
- [x] The Thread sits on the plain surface, its text is 14px, and there is more space between turns than within one. Check: screenshots against the mock.
- [x] Neighbouring tool calls fold to one line with their count and the latest call, and open to every call. Details hides them as today. Check: a web test.
- [x] The Office's lines lose their dashed boxes: a day or a run sits on a hairline, the others are small centred notes. A Thread that spans days has a day line. Check: a web test of the day line, and `message-list.test.tsx`.
- [x] A failure and an MCP server that didn't start show as a tinted strip; a refusal's reason wraps. Check: `message-list-kinds.test.tsx`.
- [x] In a large window the Thread takes the whole width of its block. Check: a screenshot of the Stage history at 1600px.
- [x] The app matches the Rows mock in Light and Dark, at 380, 620 and 900px, on the Task page, the Stage history, a person's chat and the drawer. Check: screenshots, fed the mock's messages.
- [x] Spec 4, the UI rules and the click-through say what changed. Check: read each changed line against [What was settled](#what-was-settled).

## Read first

- [UI rules](../spec/4.1-ui-rules.md), before anything the user sees.
- `apps/web/src/MAP.md`, the part on `shell/conversation/`.
- `apps/service/src/modules/conversations/MAP.md`, for step 1.

## Leave out

- Any change to Decisions, Handover notes, Proposals, Link cards, Ideas or the Office status card.
- The composer, the tabs and the Thread's head.
- The Chat and Bubbles designs.

## What was settled

With the user, 2026-11-05.

- **Rows**, over Chat and Bubbles. The user's and the person's turns differ by their avatar and name only.
- **The whole command** shows at any width, with no way for it to stay hidden.
- **The plain surface everywhere:** a Task's Thread, on the page and in the drawer, leaves the sunken timeline for the plain surface with the mock's padding. An Initiative's chapters stay boxes on the timeline.
- **The whole width:** after step 4 the user dropped the centred column: a Thread fills its block however wide the window. Long text outside a Thread keeps its reading width.

**Chosen while planning, for the user to review**

- `summary` keeps its name and takes the whole text, so the contract doesn't change. A one-line place collapses the line breaks with CSS.
- No cap on its length, as a call's input is already bounded by what the model writes. A very long command scrolls inside its row, past 320px.
- Messages already stored stay cut at 200 characters: the rest was never kept.

## Steps

- [x] 1. Whole commands: the service keeps the text, and today's tool lines and the "is working" line wrap. It goes first so the fix reaches the user before the redesign. Read: `conversations/domain/tool-activity.ts`, `message-list.tsx` (`ToolCalls`, `ToolCallWords`, `Working`), `conversation.css` (`.message-summary`, `.message-answering`).
- [x] 2. Rows: turns with their avatar, the plain surface, the text and the spacing. Read: `message-list.tsx` (`Turn`, `TurnFrame`), `conversation.css` (`.turn`), `Avatar` in `packages/ui`.
- [x] 3. Tool calls fold; the Office's lines, the day line, the strips and the centred column. Read: `message-groups.ts`, `message-list.tsx` (`MessageItem`, `ContextLine`), `apps/web/e2e/people.e2e.ts` near `.message-office`.
- [x] 4. Close: the screenshots against the mock, spec 4, the UI rules, the click-through, and `npm run verify:linux`.
- [x] 5. The whole width: the Thread's column and its text's 72ch go, in the app, the UI rules and the click-through. Read: `conversation.css` (`.message-list`, `.turn`).
- [x] 6. The plain surface on the Task page and in the drawer, the user's answer to the open question. Read: `task-conversation.tsx`, `work.css` (`.timeline-view`).

## State

Done: all six steps are built, and `npm run verify` and `npm run verify:linux` pass.

A tool call keeps its whole text; `.message-summary` shows it with `pre-wrap`, scrolling past 320px. A Turn is a row: `TurnFrame` takes its `avatar`, `by`, `at` and `labelled`; `.turn` is a grid of `--turn-gutter` and the words, 14px, Turns `--space-5` apart, messages within one `--space-2`. `ToolCalls`: a lone call is a plain line, two or more are `ToolCallFold`. `.message-office` is a centred note, `.message-log-line` sits on a hairline (`withDayLines`), `.message-notice` is the strip. The Thread fills its block, inset by `--thread-edge`; since step 5 the mock's column is a chosen difference.

Step 4 compared the running app, fed the mock's messages, with the mock: Light and Dark at 380, 620 and 900px on a person's chat, the Stage history and the drawer, and the Task page at 1100 and 1600px (at 900px and below it is the drawer), the Stage history at 1400px too. Sizes, colours and spacing match on the chat and the Stage history. Fixed: code in a Turn, as `.turn .message-text` now draws it (`--neutral-subtle`, the block's border and 12px), which read darker than the plain surface in Dark.

Chosen differences: a lone call has no fold; a Context line keeps the word "Brief"; the Brief's box stays at 320px (mock 240); 20px between Turns (mock 18), a 40px gutter (mock 38), strip padding 8 by 12px (mock 8 by 10); paragraphs in a Turn are `.markdown-text`'s 6px (mock 0.6em).

Other differences, left as built: a run has a line when it ends, not when it starts (the mock draws both); the drawer is at most about 430px wide at any window, so the mock's 620 and 900px don't arise there; a user's message with a Handover note shows its delivery in a Stage Thread, a case only the mock's data makes; the mock's Link, Idea and Office status cards were not seeded, being out of this task.

A Task's Thread, on the page and in the drawer, sits on the plain surface padded 20 and 24px (`.timeline-view-thread`); an Initiative's chapters keep their boxes on the sunken timeline.

Outside this task: at 380px the status strip makes the page scroll 32px sideways, on every page, against the UI rules' Narrow rule.

The click-through shows Turns as rows; it has no tool calls, times or Office run lines to change.

## Progress

Moved to [archive/53-thread-in-rows.md](archive/53-thread-in-rows.md).
