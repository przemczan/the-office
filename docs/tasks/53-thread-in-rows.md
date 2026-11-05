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
- [x] Neighbouring tool calls fold to one line with their count and the latest call, and open to every call. Details hides them as today. Check: a web test.
- [x] The Office's lines lose their dashed boxes: a day or a run sits on a hairline, the others are small centred notes. A Thread that spans days has a day line. Check: a web test of the day line, and `message-list.test.tsx`.
- [x] A failure and an MCP server that didn't start show as a tinted strip; a refusal's reason wraps. Check: `message-list-kinds.test.tsx`.
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
- [x] 3. Tool calls fold; the Office's lines, the day line, the strips and the centred column. Read: `message-groups.ts`, `message-list.tsx` (`MessageItem`, `ContextLine`), `apps/web/e2e/people.e2e.ts` near `.message-office`.
- [ ] 4. Close: the screenshots against the mock, spec 4, the UI rules, the click-through, and `npm run verify:linux`.

## State

Steps 1 to 3 are built; step 4 is left. A tool call keeps its whole text; `.message-summary` shows it with `pre-wrap`, scrolling past 320px. The check is the e2e test "a tool call's command shows whole…" in `work.e2e.ts`, which opens the fold first.

A turn is a row: `TurnFrame` takes its `avatar`, `by`, `at` and `labelled`. `.turn` is a grid of `--turn-gutter` and the words, 14px, `.message-text` at 72ch. Turns stand `--space-5` apart, messages within one `--space-2`. Every direct child of `.message-list` lines up with a turn's words by that gutter unless the `:not()` rule names it as The Office's own.

`ToolCalls`: a lone call is a plain line with nothing to open; two or more are `ToolCallFold`, a `<details>` with the count and the latest. `.tool-call-latest` is the one one-line place, `nowrap` collapsing the line breaks. A long tool name takes its own row above the command (`flex-wrap`), where the mock's grid would squeeze the command.

The Office's lines: `.message-office` is a small centred note (Context, Allow changes and now held lines); `.message-log-line` sits on a hairline (a run, a day). `withDayLines` in `message-groups.ts` opens each day, the first too, once what shows spans days, as a `LogLine`; `joined` splits a turn at midnight so the line can sit between. Words are `dayLineWords` in `time.ts`: Today, Yesterday, then "2 Nov".

`.message-notice` is new: `.failed` is the tinted strip (a failure, an MCP server that didn't start), `.refused` the plain warning line with words that wrap. `.message-line.failed` stays for the Idea card's error alone, with its `.in-timeline` rule, so a strip in a chapter keeps its icon, as the mock draws.

The column: `--thread-side` pads `.message-list` to centre a 720px column (`--thread-column`, the mock's 760 less its padding), chapters too. No wrapper, so the `:not()` rule still reads direct children. `Working` has the person's avatar, in the words' column as the mock.

Differs from the mock: a lone call has no fold (asked for: nothing to open); a Context line keeps the word "Brief" beside its chevron, as `people.e2e.ts` opens it by that word; the Brief's box stays at 320px (mock 240).

Looked at on a throwaway page with the real `MessageList` and CSS at 380, 900 and 1400px, Light and Dark, Details on and off: no sideways scroll, centred at 900 and 1400. Not looked at in the running app, so the Stage history's screenshot and the plain surface's box wait for step 4.

Open, for the user at step 4: the Task page's Threads are still chapters, boxes on the sunken timeline, which the mock doesn't draw. Margins between paragraphs in a turn are `.markdown-text`'s 6px (mock 0.6em), left as it serves every screen. Values chosen for tokens: 20px between turns (mock 18), a 40px gutter (mock 38), strip padding 8 by 12px (mock 8 by 10).

## Progress

- 2026-11-05 · step 1: a tool call keeps its whole text, and tool lines and the line beside "is working" wrap, scrolling past 320px; next, step 2, Rows.
- 2026-11-05 · step 2: a turn is a row with its avatar, name and time, the user's avatar neutral; the Thread sits on the plain surface at 14px, turns further apart than messages; next, step 3, the fold and the Office's lines.
- 2026-11-05 · step 3: neighbouring tool calls fold, The Office's lines lose their boxes, a Thread that spans days has day lines, failures are tinted strips, the Thread keeps a centred column and "is working" its avatar; next, step 4, the close.
