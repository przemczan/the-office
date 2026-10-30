# Progress log: 29 · Running: the `-p` fallback adapter

Moved from [29-the-p-fallback.md](../29-the-p-fallback.md) when the task was done. One line per commit, newest last.

- 2026-10-30 · step 0: questions settled (start at login dropped, the fallback at parity with the SDK adapter); spec 3, 5.1, 5.4 amended; next is step 1, the engine check's fallback runs.
- 2026-10-30 · step 1: the engine check runs the pinned binary in `-p` (`fallback.*`, 7 checks) on Windows and Linux; every capability holds, Office tools and rules reach `localhost` with a per-session token; next is step 2, an engine per Role.
- 2026-10-30 · step 2: an engine per Role: ids and models in Engine's public entry, `AgentEngines`, sessions start and resume on the engine their settings name, capabilities per engine, a Thread's session keeps its engine and a changed engine starts fresh; the fallback a refusing placeholder; next is step 3, the Office tools and rules over `localhost`.
- 2026-10-30 · step 3: the fallback's hook and MCP endpoints in the service under `/api/engine/claude-code-p/`, a token per session (`SessionEndpoints`), every Office tool call judged by the session's rules and ToolHold; shared Claude Code pieces in `adapters/claude-code/`; next is step 4, `ClaudeCodePEngine`.
- 2026-10-30 · step 4 (not ticked): `ClaudeCodePEngine` runs sessions on the pinned binary in `-p`; the live contract passes on Linux and fails `barge-in` on Windows (an Office tool's answer races a `next` message); the fix is the user's choice (State); next is that answer, then step 5.
- 2026-10-30 · step 4a planned: the user chose Office tools through the binary's stream (spec 5.4 Defaults amended), keeping "engine changed"; next is step 4a.
- 2026-10-30 · step 4a: Office tools served in-process through the binary's stream (`mcp_message`), the MCP endpoint removed, the hook kept; engine check re-run plus `fallback.priority-next-office-tool` on both platforms; live contract 10/10 on Windows and Linux, so step 4 ticked with DoD 1-2; next is step 5.
- 2026-10-30 · step 4a follow-up: `fallback.start` re-run; its usage-window difference on Linux holds on the old route too (account state, before any turn), noted in engine-check.md; next is step 5.
- 2026-10-30 · step 5: the Role card's Engine field already offered "Claude Code -p" with the models the service sends; Playwright switches a Role to it, saves, and finds it on the card and in the change history; next is step 6, the live check.
- 2026-10-30 · step 6: task 12's Test Project check runs on the fallback (`OFFICE_CHECK_ENGINE` in `test/live-check.ts`); `fallback.start` records only that the usage query answers; verify and verify:linux pass; task done.
