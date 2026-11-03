# 6. Permissions and safety

From [25](../../.scratch/the-office/issues/25-agent-permissions.md), amending [05](../../.scratch/the-office/issues/05-roles.md), [08](../../.scratch/the-office/issues/08-pipelines.md), [09](../../.scratch/the-office/issues/09-conversations.md).

- **Threat model:** the rules guard against an Agent's mistakes and keep the user in charge of what leaves the workstation; they do not contain a hostile Agent. Native Windows has no command sandbox, and Linux runs under the same rules so both behave alike; stronger containment (the engine's sandbox on Linux and WSL2, or a separate user) is not planned.
- **Two layers:**
  - **Office rules in code,** which no profile loosens: Agents never change git (read-only `status`, `diff`, `log`, `show` only, every Stage; the one exception is the Caretaker with Allow changes on); the HEAD and branch check; worktree restore after tests; the enforced Hard switches; the secrets refusal; one `PreToolUse` hook that sees every call the engine's own input validation lets through, before any rule decides. The Office sets no path-scoped deny rule, which would refuse before the hook; validation refusals show only in `result.permission_denials` and are logged from there.
  - **A permission profile as data on the Role card:** read, edit, run, web. A Stage may narrow it, never widen it. Editable in tier 2.
- **Hard switches:**

  | | Run installs | Publish outside the Pipeline | Change Roles |
  |---|---|---|---|
  | Developer | Consult Devops | Consult CTO | Never |
  | Reviewer, Planner | Consult Devops | Never | Never |
  | Devops | Allowed | Consult CTO | Never |
  | CTO | Consult Devops | Ask me | Never |
  | Office Manager | Never | Never | Ask me |
  | Caretaker (fixed) | Allowed | Allowed | Never |

  - **Enforced by The Office:** change Roles (an Office tool) and git. **Followed by the Agent:** run installs and publish outside the Pipeline. The Office stays agnostic of each Project's stack, so the brief states them in plain words ("Before you install anything that changes the machine outside the worktree, consult Devops; adding or updating the Project's own dependencies is a code change") and the Agent asks through the consult tool first. The Role card marks which are enforced and which are followed.
  - A held call waits on a Consultation (Consult *person*) or a Decision (Ask me). Approvals by colleagues show on the Task, in the Stage log and as one line in Since you left; never a Notification. A Decision never grants "always"; widening permissions is a Role card change.
- **MCP tools:** each tool of a Role's MCP servers ([5.4](5.4-the-engine.md#defaults)) has its own setting in the Role card's permission profile, set like a Hard switch to Allowed, Consult a person, Ask me or Never, and starting at Consult Devops; a Stage may narrow it, never widen it. A held call waits as a Hard switch's does. Enforced by The Office: the hook judges every MCP tool call (the user, 2026-10-31).
- **Other refusals** are immediate, with a reason the Agent reads ("Not allowed for a Reviewer: editing files. Open a Decision if you need it."), logged on the Thread.
- **Default profiles:**

  | | Read | Edit | Run commands | Web |
  |---|---|---|---|---|
  | Planner (planning on a Task, chat) | The worktree; the base branches in chat | No | Read-only git | Search and fetch |
  | Developer (Implement, Review & fix) | The worktree | The worktree | Anything in the worktree except git changes; installs and publishing follow the switches | Search and fetch |
  | Reviewer (optional independent review) | The worktree | No | The Project's own commands and read-only git | Search and fetch |
  | Caretaker (fixed; with Allow changes on, else as a chat) | Anything but secrets | Anything but secrets | Anything, every git command included | Search and fetch |

  Everyone also reads their session's skills folder and the engine's output of their own background commands, and uses the Office tools.
- **Chats only read:** a chat session reads every Project's base branch, searches the web and uses the Office tools (read records, capture an Idea, open a Task); no edits, read-only commands only. The one exception is a Caretaker Thread with Allow changes on ([2.4](2.4-conversations.md)).
- **The Caretaker with Allow changes on** works on the whole workstation: its working folder is the user's home folder; it reads and edits anywhere (The Office's data folder, `.git`, `.claude` and `.mcp.json` included) and runs any command, `git push` too. Only the secrets refusal still holds, for reads and changes alike, and the fire alarm still holds every call: it is the user's stop. With it off, the Caretaker is refused as any chat is (the user's answers of 2026-11-03).
- **Secrets:** the hook refuses reads, by file tools or in command text, of `~/.ssh`; the Claude credentials (`~/.claude/.credentials.json`, and each Claude Code engine's account folder in the Office data, `<office-data>/engines/`, tier 3; a token pasted for an engine is written there as the folder's credentials file, sits in no environment, and is refused to Agents as the folder is, the user's answer of 2026-11-02); `~/.config/gh`; `~/.aws`; browser profiles (where each lives on Windows and on Linux is the platform layer's); the Office identity's folder, `<office-data>/identity/`, which holds its ssh key; and the database credentials (The Office's `.env`). The list is kept apart from The Office's own files: every session but the Caretaker's with Allow changes on is refused The Office's own data as well, exactly as before; that one is refused the secrets only. A `.env` inside the worktree stays readable. The clones of Projects added by Repository URL, in `<office-data>/repositories/`, are left out of The Office's own data, so a cloned Project's folder reads as a path-added one's does (the user, 2026-11-01).
- **Build rules:**
  - Runtime decisions (holding, refusing with a reason) are made in hooks: `permissionPrompts: 'none'` skips `canUseTool`, and refuses whatever would prompt, so the Office tools are allowed by rule.
  - Path decisions (secrets, protected paths, what lies outside the worktree) are made in the hook, never in path-scoped deny rules.
  - Refusals are logged from the hook's own decisions, `permission_denied` messages and `result.permission_denials`; the `PermissionDenied` hook is not relied on, since it fires for none of them.
  - Every shell rule has a PowerShell twin on Windows: a Bash rule does not reach the PowerShell tool (with the engine's default tool set a Bash deny rule alone would turn PowerShell off instead). On Linux the Bash rules apply alone.
  - The hook alone fences Read, Grep and Glob to the session's folders (the worktree, or the base branches in chat) and its skills folder, and lets a session read the engine's output files of its own background commands (the engine's temporary folder, then the working folder's name, the session id and `tasks`). `permissions.blockReadsOutsideWorkingDirectories` is off: under it the engine also judges every shell command and refuses, past the hook's allow, any it can't show reads only inside (a variable in braces, another folder named), with no approval surface to ask (the engine check's `permissions.read-fence-off`; the user's answer of 2026-10-31). Shell reads outside run wherever the profile allows the command, and are accepted under the threat model. Without the fence the engine loads the instruction files (`CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/rules/`) of every folder above the session's as the Project's own, the user's `~/.claude/CLAUDE.md` among them when the Office data directory is under their home folder, so `claudeMdExcludes` names each of them; a Project's own instructions, inside the worktree, still load.
  - The Office ends a session's leftover processes (dev servers, watchers) when its Stage ends.
  - `.git`, `.claude` and `.mcp.json` are protected paths: the hook refuses Agents' writes there first (but the Caretaker's with Allow changes on), with a clear reason; the engine's own protection (it never auto-approves them, and its refusal reads like any other prompt refusal) stays as a backstop. It still refuses a Claude Code engine's Edit and Write there for the Caretaker too, who changes those paths by commands instead. The Office's own writes there go through Office code, not Agents.
