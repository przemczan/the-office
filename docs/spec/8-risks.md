# 8 Risks

Covers: subscription terms, undocumented internals, unseen refusals, no sandbox, language servers, quota, carrying a session to a Stand-in Engine, the PowerShell tool, cache.

## Subscription terms

- Terms for programmatic use change; a multi-agent office running all day is a gray zone under "ordinary, individual usage".
- Mitigation: the engine boundary, pinned versions, the `-p` switch on each Claude Code engine, and engines of other engine types (Codex, Copilot CLI, the OpenAI-compatible API) ([5.4](5.4-the-engine.md)).

## Undocumented internals

- The skills allowlist's suffix matching and plugin detection were read from the binary.
- The permission behaviour comes from docs fetched as summaries.
- The [engine check](../engine-check.md) re-checks them on every version bump.

## Unseen refusals

- A turn refused for a used-up usage window is detected from the pinned SDK's typings and binary on the Claude Code engines and from the protocol on the Codex engine; neither has been recorded live.
- The engine-level reading of the usage windows hasn't run live on either platform either.

## No sandbox

- The Claude Code and OpenAI-compatible API engines have none (none on native Windows, none used on Linux): an Agent's shell can read and write outside the worktree.
- Installs and outside publishing rest on Agents following rules.
- Backstops: per-Stage commits, the HEAD check, the Office tools.
- The Codex engine's sandbox has been checked on Linux only.

## Language servers

- They run Project code outside the hook, in read-only sessions too ([6](6-permissions-and-safety.md#language-servers-run-project-code)).

## Quota

- Parallel sessions spend quota about N times as fast.
- Usage windows are account-wide, so per-session quota is only an estimate.

## Carrying a session to a Stand-in Engine

- It copies Claude Code's transcript files by their layout, which a Claude Code update may change.
- The engine check's carry-over cases guard it.
- Only Claude Code is carried: on a stand-in of another engine type a Thread goes on fresh, without its context ([5.4.6](5.4.6-stand-in-engines-and-usage-windows.md#stand-ins-of-another-engine-type)).

## The PowerShell tool

- It is a preview, with its own rule quirks.

## Cache

- A Decision answered after more than an hour resumes on a cold cache; the label shows it, and the Context policy may start fresh.
