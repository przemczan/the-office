# 53 · The Thread in Rows

Status: in progress

## Goal

Every Thread reads like a team channel, as drawn in the Rows design of [docs/design/thread-dialog.html](../design/thread-dialog.html): each turn has an avatar, a name and a time, on the left, for the user and the person alike. Decisions, Handover notes and the other cards stay as they are.

The user can always read a tool call's whole command, however narrow the window. Today a long one is cut in two places: the page clips it to one line with no way to open it, and the service stores only its first 200 characters.

## Definition of Done

- [x] A tool call keeps its whole text, line breaks included. Check: `tool-activity.test.ts`, with a command over 200 characters and one of several lines.
- [x] Every command shows whole at any width: it wraps, and only a very long one scrolls in its place. The line beside "is working" wraps too. Check: a web test, and a screenshot at 380px of a command over 200 characters.
- [x] A turn has its avatar, name and time on the left; the user's avatar is neutral. Neighbouring messages still join into one turn. Check: `message-list-kinds.test.tsx`.
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

- [x] 1. Whole commands: the service keeps the text, and today's tool lines and the "is working" line wrap. It goes first so the fix reaches the user before the redesign. Read: `conversations/domain/tool-activity.ts`, `message-list.tsx` (`ToolCalls`, `ToolCallWords`, `Working`), `conversation.css` (`.message-summary`, `.message-answering`).
- [x] 2. Rows: turns with their avatar, the plain surface, the text and the spacing. Read: `message-list.tsx` (`Turn`, `TurnFrame`), `conversation.css` (`.turn`), `Avatar` in `packages/ui`.
- [ ] 3. Tool calls fold; the Office's lines, the day line, the strips and the centred column. Read: `message-groups.ts`, `message-list.tsx` (`MessageItem`, `ContextLine`), `apps/web/e2e/people.e2e.ts` near `.message-office`.
- [ ] 4. Close: the screenshots against the mock, spec 4, the UI rules, the click-through, and `npm run verify:linux`.

## State

Steps 1 and 2 are built. A tool call keeps its whole text; `.message-summary` shows it with `pre-wrap` and `overflow-wrap: anywhere`, scrolling past 320px, and `.tool-calls .message-line` and `.message-answering` wrap. The check is the e2e test "a tool call's command shows whole…" in `work.e2e.ts`. `.message-summary` also serves refusals, so a refusal's reason wraps already; its box still waits for step 3's test.

A turn is a row: `TurnFrame` takes its `avatar`, `by`, `at` and `labelled` (a name carrying a note, as "You · answering the Decision", reads quieter). `YourAvatar` is the `Avatar` with the gray of its own tints, through `style`. `.turn` is a grid of `--turn-gutter` (`--space-10`, set on `.message-list`) and the words, 14px at line height 1.6, `.message-text` at 72ch. Turns stand `--space-5` apart, messages within one `--space-2`. `.message-list` paints `--surface`, but a chapter paints its own.

Every direct child of `.message-list` lines up with a turn's words by that gutter, cards included, unless the `:not()` rule names it as The Office's own (`.message-office`, `.message-log-line`, `.message-details-hidden`). Cards in a list take the whole column; `.message`'s 92% stays for the cards outside a Thread, as the Gate card in Needs you.

Values chosen against the mock, for tokens: 20px between turns (mock 18), a 40px gutter (mock 38). The avatar is `xs`, 20px, as the mock's.

Looked at on a throwaway page holding the real `MessageList` and CSS, at 380 and 900px in Light and Dark and inside a chapter: no sideways scroll, and it reads as the mock. Not yet looked at in the running app, so the plain surface's box waits for step 4.

Open, for the user at step 4: the Task page's Threads are still chapters, boxes on the sunken timeline, which the mock doesn't draw. The words sit on the plain surface inside them, so they stayed. Margins between paragraphs in a turn are `.markdown-text`'s 6px (mock 0.6em), left as it serves every screen.

Traps for step 3: the fold is the one-line place, so it adds the CSS that collapses the line breaks, as `.message-summary` no longer does. The e2e test and `message-list-kinds.test.tsx` read `.tool-calls .message-summary` on neighbouring calls, so they must open the fold first. `.turn + .tool-calls` pulls a tool line up to its turn. The mock's "is working" line has the person's avatar; `Working` doesn't yet. `.message-office` is used by `people.e2e.ts` and `message-list.test.tsx`; a new class for the Office's lines joins the `:not()` rule.

## Progress

- 2026-11-05 · step 1: a tool call keeps its whole text, and tool lines and the line beside "is working" wrap, scrolling past 320px; next, step 2, Rows.
- 2026-11-05 · step 2: a turn is a row with its avatar, name and time, the user's avatar neutral; the Thread sits on the plain surface at 14px, turns further apart than messages; next, step 3, the fold and the Office's lines.
