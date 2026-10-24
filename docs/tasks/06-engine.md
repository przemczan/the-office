# 06 · The Engine module: port, Agent SDK adapter and Office rules

Status: todo

## Goal

The Engine module runs sessions behind an `AgentEngine` port that isn't Claude-shaped, with two adapters: the Agent SDK on the user's own login, and a scripted adapter that replays recorded sessions so every later test runs without model calls. Every tool call passes one `PreToolUse` hook that applies the Office rules in code and the permission profile it is given as data. Usage and the 5-hour window come out of the stream.

## Definition of Done

- [ ] The port covers: start a session with a brief and options, send a message with a priority, interrupt, resume by session id, end (with its process tree), and a typed stream of messages, tool calls, usage and rate-limit events; each adapter declares its capabilities. Check: the port's contract tests run against both adapters.
- [ ] The Agent SDK adapter starts sessions with the lean option set [engine-check.md](../engine-check.md) settled, and two sessions in different worktrees of one repository share their cached prefix. Check: the adapter's integration test reads cache tokens on the second session.
- [ ] The hook refuses, with a reason the Agent reads: a git command that changes anything; reads of the secrets of spec §6; anything outside the given profile. Each shell rule has a PowerShell twin. Check: unit tests per rule for Bash and PowerShell, and one live session that is refused and reads the reason.
- [ ] Every engine call is a span with input, output, cache-read and cache-write tokens and cost; `rate_limit_event` updates an Office-wide window state (5-hour and 7-day utilization and reset time) published as a domain event. Check: the trace in Grafana and the event in a test.
- [ ] Ending a session ends every process it started (dev servers, watchers). Check: a session that starts a long-running process, then end it and look for the process.
- [ ] Office tools: modules register in-process tools on one registry, and a session gets the ones its caller names. Check: a test tool called from a live session.

## Read first

- [Spec §5.4](../spec.md#54-the-engine), [§6](../spec.md#6-permissions-and-safety), [§8 risks](../spec.md#risks).
- [engine-check.md](../engine-check.md): every result, above all the option set, the hook's behaviour and the PowerShell twins.
- [research/agent-engines.md](../../.scratch/the-office/research/agent-engines.md) §2–§8.
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §11.1 (lean harness), §11.4 (telemetry by prompt feature), §11.9 (the scripted runner seam).
- Reference, behaviour only, in `D:\Projects\software-factory\apps\runner\src\`: `claude/claude-invocation.ts`, `claude/claude-stream-observer.ts`, `stages/stage-profiles.ts` (the git deny list), `test-support/scripted-stage-runner.ts`.

## Steps

- [ ] 1. The port in `modules/engine/ports/`: session options (cwd, model, effort, brief, skills folder, profile, Office tools, output schema), the stream types and the capability flags. The scripted adapter replays a recorded stream file and records new ones from the SDK adapter. Contract tests against the scripted adapter. Commit.
- [ ] 2. The Agent SDK adapter: one long-lived streaming `query()` per session, the lean options, priority on sent messages, `interrupt()`, resume by session id, and the stream mapped onto the port's types. Contract tests against it with the cheapest model. Commit.
- [ ] 3. The Office rules hook: git read-only (`status`, `diff`, `log`, `show`), secrets refused by file tools and in command text, protected paths, reads fenced to the worktree and the session's folders, each shell rule with its PowerShell twin, and the profile (read, edit, run, web) applied as data. Refusals carry a reason and are emitted as events for the Thread log. Commit.
- [ ] 4. Usage and the window: per-call usage on spans and metrics tagged with the prompt features used (skills, Office tools), `rate_limit_event` into the window state and its event, and an "engine down" event when the binary can't start or the stream dies. Commit.
- [ ] 5. Process cleanup on end, and the Office tools registry built on `createSdkMcpServer()`. Commit.
- [ ] 6. Check on the Test Project: a read-only session in a worktree that reads a file, is refused a git commit and an `~/.ssh` read, and reports usage; record its stream for the scripted adapter's fixtures. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
