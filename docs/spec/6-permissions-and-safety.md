# 6. Permissions and safety

From [25](../../.scratch/the-office/issues/25-agent-permissions.md), amending [05](../../.scratch/the-office/issues/05-roles.md), [08](../../.scratch/the-office/issues/08-pipelines.md), [09](../../.scratch/the-office/issues/09-conversations.md).

- **Threat model:** the rules guard against an Agent's mistakes and keep the user in charge of what leaves the workstation; they do not contain a hostile Agent. Native Windows has no command sandbox, and Linux runs under the same rules so both behave alike; stronger containment (the engine's sandbox on Linux and WSL2, or a separate user) is tier 3.
- **Two layers:**
  - **Office rules in code,** which no profile loosens: Agents never change git (read-only `status`, `diff`, `log`, `show` only, every Stage); the HEAD and branch check; worktree restore after tests; the enforced Hard switches; the secrets refusal; one `PreToolUse` hook that sees every call the engine's own input validation lets through, before any rule decides. The Office sets no path-scoped deny rule, which would refuse before the hook; validation refusals show only in `result.permission_denials` and are logged from there.
  - **A permission profile as data on the Role card:** read, edit, run, web. A Stage may narrow it, never widen it. Editable in tier 2.
- **Hard switches:**

  | | Run installs | Publish outside the Pipeline | Change Roles |
  |---|---|---|---|
  | Developer | Consult Devops | Consult CTO | Never |
  | Reviewer, Planner | Consult Devops | Never | Never |
  | Devops | Allowed | Consult CTO | Never |
  | CTO | Consult Devops | Ask me | Never |
  | Office Manager | Never | Never | Ask me |

  - **Enforced by The Office:** change Roles (an Office tool) and git. **Followed by the Agent:** run installs and publish outside the Pipeline. The Office stays agnostic of each Project's stack, so the brief states them in plain words ("Before you install anything that changes the machine outside the worktree, consult Devops; adding or updating the Project's own dependencies is a code change") and the Agent asks through the consult tool first. The Role card marks which are enforced and which are followed.
  - A held call waits on a Consultation (Consult *person*) or a Decision (Ask me). Approvals by colleagues show on the Task, in the Stage log and as one line in Since you left; never a Notification. A Decision never grants "always"; widening permissions is a Role card change.
- **Other refusals** are immediate, with a reason the Agent reads ("Not allowed for a Reviewer: editing files. Open a Decision if you need it."), logged on the Thread.
- **Default profiles:**

  | | Read | Edit | Run commands | Web |
  |---|---|---|---|---|
  | Planner (planning on a Task, chat) | The worktree; the base branches in chat | No | Read-only git | Search and fetch |
  | Developer (Implement, Review & fix) | The worktree | The worktree | Anything in the worktree except git changes; installs and publishing follow the switches | Search and fetch |
  | Reviewer (optional independent review) | The worktree | No | The Project's own commands and read-only git | Search and fetch |

  Everyone also reads their session's skills folder and the engine's output of their own background commands, and uses the Office tools.
- **Chats only read:** a chat session reads every Project's base branch, searches the web and uses the Office tools (read records, capture an Idea, open a Task); no edits, read-only commands only.
- **Secrets:** the hook refuses reads, by file tools or in command text, of `~/.ssh`, the Claude credentials in `~/.claude`, `~/.config/gh`, `~/.aws`, browser profiles (where each lives on Windows and on Linux is the platform layer's), and The Office's own data and database credentials. A `.env` inside the worktree stays readable.
- **Build rules:**
  - Runtime decisions (holding, refusing with a reason) are made in hooks: `permissionPrompts: 'none'` skips `canUseTool`, and refuses whatever would prompt, so the Office tools are allowed by rule.
  - Path decisions (secrets, protected paths, what lies outside the worktree) are made in the hook, never in path-scoped deny rules.
  - Refusals are logged from the hook's own decisions, `permission_denied` messages and `result.permission_denials`; the `PermissionDenied` hook is not relied on, since it fires for none of them.
  - Every shell rule has a PowerShell twin on Windows: a Bash rule does not reach the PowerShell tool (with the engine's default tool set a Bash deny rule alone would turn PowerShell off instead). On Linux the Bash rules apply alone.
  - The hook alone fences Read, Grep and Glob to the session's folders (the worktree, or the base branches in chat) and its skills folder, and lets a session read the engine's output files of its own background commands (the engine's temporary folder, then the working folder's name, the session id and `tasks`). `permissions.blockReadsOutsideWorkingDirectories` is off: under it the engine also judges every shell command and refuses, past the hook's allow, any it can't show reads only inside (a variable in braces, another folder named), with no approval surface to ask (the engine check's `permissions.read-fence-off`; the user's answer of 2026-10-31). Shell reads outside run wherever the profile allows the command, and are accepted under the threat model.
  - The Office ends a session's leftover processes (dev servers, watchers) when its Stage ends.
  - `.git`, `.claude` and `.mcp.json` are protected paths: the hook refuses Agents' writes there first, with a clear reason; the engine's own protection (it never auto-approves them, and its refusal reads like any other prompt refusal) stays as a backstop. The Office's own writes there go through Office code, not Agents.
