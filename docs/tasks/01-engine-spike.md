# 01 · Engine spike: pinned versions and the engine check

Status: todo

## Goal

Pin the Agent SDK version and settle, against live sessions on it, everything tier 1 takes on trust about the engine: the skills mechanism of [spec §5.6](../spec.md#56-skills-per-session), the permission build rules of [§6](../spec.md#6-permissions-and-safety), and the engine behaviours of [§5.4](../spec.md#54-the-engine) that the "Could not confirm" lists leave open. The result is a re-runnable check, because the spec requires these to be re-checked on every version bump.

## Definition of Done

- [ ] `@anthropic-ai/claude-agent-sdk` is pinned to an exact version, and the Claude Code version it bundles is recorded. Check: `package.json` and [engine-check.md](../engine-check.md).
- [ ] Every check listed in the Steps has a recorded result on the pinned version: what was run, what was observed, what it means for the build. Check: [engine-check.md](../engine-check.md) has one entry per check, none blank.
- [ ] Every result that contradicts the spec has amended the spec in the same task, and the user has been told. Check: the Progress log names each amendment.
- [ ] `npm run engine-check` re-runs the checks and exits non-zero when a result differs from the recorded one. Check: run it, then break one expectation and see it fail.
- [ ] The checks have run on Windows and on Linux, with results recorded per platform where they differ; PowerShell checks run on Windows only. Check: [engine-check.md](../engine-check.md) names both runs.

## Read first

- [Spec §5.4](../spec.md#54-the-engine), [§5.6](../spec.md#56-skills-per-session), [§6](../spec.md#6-permissions-and-safety).
- [research/skills-per-session.md](../../.scratch/the-office/research/skills-per-session.md): "Could not confirm" and "Recommended mechanism".
- [research/agent-engines.md](../../.scratch/the-office/research/agent-engines.md): §3 (injecting messages), §4 (resume), §5 (cache), §7 (hooks), §8 (usage), "Could not confirm".
- Reference, behaviour only: `D:\Projects\software-factory\apps\runner\src\claude\claude-invocation.ts` (lean flags), `claude-stream-observer.ts` (cache TTL detection).

## Steps

Each check runs in a throwaway git repository created in a temp folder, uses the cheapest model with tiny prompts, and records its tokens. Checks that only concern `claude -p` are tier 2 and skipped.

- [ ] 1. Workspace root: `package.json` with npm workspaces, `.nvmrc` (Node 22), `tsconfig.base.json` (strict), `.gitignore` for `node_modules` and build output. Add `tools/engine-check` with the SDK pinned to the latest release (exact version, no range). Commit.
- [ ] 2. A harness in `tools/engine-check` that starts a session with the options of spec §5.6 (session plugin folder, `settingSources: ['project']`, `skills`, the settings), collects the `init` message, `getContextUsage()`, every stream event and every hook call, and compares each check's observation with its recorded expectation. Commit.
- [ ] 3. Skills checks:
  - the start check itself: `init` lists the plugin with no errors, and the skill names in `getContextUsage()` equal the expected set;
  - the allowlist's suffix matching and single-plugin detection on the pinned version (read from 2.1.308 before);
  - `skillOverrides: "off"` against nested Project skill names (`apps/web:deploy`) and `.claude/commands` files;
  - user-scope installed plugins and already-synced skills under `settingSources: ['project']`;
  - whether reads of the session plugin's skill folder are allowed with `blockReadsOutsideWorkingDirectories` on;
  - a changed skill set on resume (snapshot or re-read);
  - whether a `Skill(name)` deny rule removes the skill from the listing.

  Commit.
- [ ] 4. Permission checks:
  - a `PreToolUse` hook sees every tool call first, under `permissionPrompts: 'none'`;
  - a hook can refuse with a reason the Agent reads and acts on;
  - a Bash deny rule alone turns the PowerShell tool off, and a twin rule keeps it on;
  - `blockReadsOutsideWorkingDirectories` fences the file tools to the worktree and the session's folders;
  - `.git`, `.claude` and `.mcp.json` are never auto-approved;
  - hook decisions still apply after a resume.

  Commit.
- [ ] 5. Engine behaviour checks:
  - message `priority: 'next'` lands between tool calls, `'later'` after the turn, `'now'` interrupts;
  - `interrupt()` stops the turn and the session can be resumed;
  - an Agent told by an Office tool's result to end its turn and wait does so, and an answer sent as the next message after more than an hour continues the work in that session (this is how Agents wait on Decisions);
  - resume by session id within the hour reads the cache (cache-read tokens above zero);
  - `rate_limit_event` carries utilization and `resetsAt` for `five_hour` and `seven_day`;
  - three sessions run in parallel;
  - an in-process tool from `createSdkMcpServer()` is callable;
  - the lean option set: context size of a first call, and whether two worktrees of the same repository get an identical cached prefix.

  Commit.
- [ ] 6. Write [engine-check.md](../engine-check.md): the pinned versions, then one entry per check (run, observed, meaning for the build). Amend spec §5.4, §5.6 or §6 where a result contradicts it, tell the user, and log each amendment. Commit.
- [ ] 7. `npm run engine-check` at the root runs the whole check; [engine-check.md](../engine-check.md) opens with when to run it (every SDK bump, before the bump is merged, on both platforms). Commit.
- [ ] 8. Run the check on Linux: ask the user for a Linux system signed in to Claude Code (a WSL distribution or another machine), run it there, and record what differs. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
