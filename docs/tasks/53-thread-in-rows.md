# 53 · The Thread in Rows

Status: todo

## Goal

Every Thread reads like a team channel, as drawn in the Rows design of [docs/design/thread-dialog.html](../design/thread-dialog.html): each turn has an avatar, a name and a time, on the left, for the user and the person alike. Decisions, Handover notes and the other cards stay as they are.

The user can always read a tool call's whole command, however narrow the window. Today a long one is cut in two places: the page clips it to one line with no way to open it, and the service stores only its first 200 characters.

## Definition of Done

- [ ] A tool call keeps its whole text, line breaks included. Check: `tool-activity.test.ts`, with a command over 200 characters and one of several lines.
- [ ] Every command shows whole at any width: it wraps, and only a very long one scrolls in its place. The line beside "is working" wraps too. Check: a web test, and a screenshot at 380px of a command over 200 characters.
- [ ] A turn has its avatar, name and time on the left; the user's avatar is neutral. Neighbouring messages still join into one turn. Check: `message-list-kinds.test.tsx`.
- [ ] The Thread sits on the plain surface, its text is 14px, and there is more space between turns than within one. Check: screenshots against the mock.
- [ ] Neighbouring tool calls fold to one line with their count and the latest call, and open to every call. Details hides them as today. Check: a web test.
- [ ] The Office's lines lose their dashed boxes: a day or a run sits on a hairline, the others are small centred notes. A Thread that spans days has a day line. Check: a web test of the day line, and `message-list.test.tsx`.
- [ ] A failure and an MCP server that didn't start show as a tinted strip; a refusal's reason wraps. Check: `message-list-kinds.test.tsx`.
- [ ] In a large window the Thread stays in a centred column at reading width. Check: a screenshot of the Stage history.
- [ ] The app matches the Rows mock in Light and Dark, at 380, 620 and 900px, on the Task page, the Stage history, a person's chat and the drawer. Check: screenshots, fed the mock's messages.
- [ ] Spec 4, the UI rules and the click-through say what changed. Check: read each changed line against [What was settled](#what-was-settled).

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

**Chosen while planning, for the user to review**

- `summary` keeps its name and takes the whole text, so the contract doesn't change. A one-line place collapses the line breaks with CSS.
- No cap on its length, as a call's input is already bounded by what the model writes. A very long command scrolls inside its row, past 320px.
- Messages already stored stay cut at 200 characters: the rest was never kept.

## Steps

- [ ] 1. Whole commands: the service keeps the text, and today's tool lines and the "is working" line wrap. It goes first so the fix reaches the user before the redesign. Read: `conversations/domain/tool-activity.ts`, `message-list.tsx` (`ToolCalls`, `ToolCallWords`, `Working`), `conversation.css` (`.message-summary`, `.message-answering`).
- [ ] 2. Rows: turns with their avatar, the plain surface, the text and the spacing. Read: `message-list.tsx` (`Turn`, `TurnFrame`), `conversation.css` (`.turn`), `Avatar` in `packages/ui`.
- [ ] 3. Tool calls fold; the Office's lines, the day line, the strips and the centred column. Read: `message-groups.ts`, `message-list.tsx` (`MessageItem`, `ContextLine`), `apps/web/e2e/people.e2e.ts` near `.message-office`.
- [ ] 4. Close: the screenshots against the mock, spec 4, the UI rules, the click-through, and `npm run verify:linux`.

## State

Nothing built yet. The Rows design is in the mock; its `DESIGNS.rows` and the `[data-design="rows"]` rules are what to compare against, not CSS to copy.

Traps: the `Avatar` tints by name, so the user's neutral one needs a way to ask for it. `.message-office` and `.turn-by` are used by tests, including `people.e2e.ts`. `MessageList` serves every Thread, so a change shows on the Task page, the Stage history, people's chats and the drawer at once.

## Progress
