# 8. Risks

- **Subscription terms** for programmatic use change; a multi-agent office running all day is a gray zone under "ordinary, individual usage". Mitigation: the engine boundary, pinned versions, the `-p` switch on each Claude Code engine, and engines of other kinds (Codex, Copilot CLI, the OpenAI-compatible API) ([5.4](5.4-the-engine.md)).
- **Undocumented internals:** the skills allowlist's suffix matching and plugin detection were read from the binary, and the permission behaviour comes from docs fetched as summaries. The [engine check](../engine-check.md) re-checks them on every version bump.
- **Unseen refusals:** a turn refused for a used-up usage window is detected from the pinned SDK's typings and binary on the Claude Code engines and from the protocol on the Codex engine; neither has been recorded live. The engine-level reading of the usage windows hasn't run live on either platform either.
- **No sandbox on the Claude Code and OpenAI-compatible API engines** (none on native Windows, none used on Linux): an Agent's shell can read and write outside the worktree; installs and outside publishing rest on Agents following rules. Backstops: per-Stage commits, the HEAD check, the Office tools. The Codex engine's sandbox has been checked on Linux only.
- **Language servers run Project code** outside the hook, in read-only sessions too ([6](6-permissions-and-safety.md)).
- **Quota:** parallel sessions spend quota about N times as fast, and usage windows are account-wide, so per-session quota is only an estimate.
- **Carrying a session to a Stand-in Engine** copies Claude Code's transcript files by their layout, which a Claude Code update may change; the engine check's carry-over cases guard it.
- **The PowerShell tool is a preview** with its own rule quirks.
- **Cache:** a Decision answered after more than an hour resumes on a cold cache; the label shows it, and the Context policy may start fresh.
