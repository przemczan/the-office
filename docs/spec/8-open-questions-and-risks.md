# 8. Open questions and risks

## Open questions, by the tier that needs them

None blocks tier 1. Each becomes a ticket when its tier starts.

- **Tier 2:** the form of shared memory and how the user reads and edits it; whether Tasks of an Initiative still being shaped can be planned and started; whether the Office Manager can be let go; folding a Proposal's Role card in chat.
- **Tier 3:** quota and usage estimates; integrations.

## Risks

- **Subscription terms** for programmatic use are being revised; a 24/7 multi-agent office is a gray zone under "ordinary, individual usage". Mitigation: the engine boundary, pinned versions, the `-p` fallback in tier 2 ([02](../../.scratch/the-office/issues/02-agent-engines.md)).
- **Undocumented internals:** the skills allowlist's suffix matching and plugin detection were read from the binary, and the permission behaviour comes from docs fetched as summaries. Re-check on every version bump; the spike checks them first.
- **No sandbox** (none on native Windows, none used on Linux): an Agent's shell can read and write outside the worktree; installs and outside publishing rest on Agents following rules. Backstops: per-Stage commits, the HEAD check, the Office tools.
- **Quota:** parallel sessions spend quota about N times as fast, and plan windows are account-wide, so per-session quota is only an estimate.
- **The PowerShell tool is a preview** with its own rule quirks.
- **Cache:** a Decision answered after more than an hour resumes on a cold cache; the label shows it, and the Context policy may start fresh.
