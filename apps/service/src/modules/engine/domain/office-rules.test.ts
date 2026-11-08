import { describe, expect, it } from "vitest";
import { linux } from "../../../platform/os/linux.js";
import type { OperatingSystem } from "../../../platform/os/operating-system.js";
import { windows } from "../../../platform/os/windows.js";
import type { AgentAction } from "./agent-action.js";
import { OfficeRules } from "./office-rules.js";
import type { PermissionProfile } from "./permission-profile.js";
import type { ShellDialect } from "./shell-commands.js";

/** Windows paths as written, backslashes and all. */
const raw = String.raw;

interface Platform {
  readonly name: string;
  readonly system: OperatingSystem;
  readonly home: string;
  readonly worktree: string;
  readonly otherWorktree: string;
  readonly skillsFolder: string;
  readonly dataDirectory: string;
  readonly officeEnvFile: string;
  /** A file of the system's outside every session folder. */
  readonly systemFile: string;
  /** The shells Agents run commands in there, by their dialect. */
  readonly dialects: readonly ShellDialect[];
  /** The home folder as a Bash command there names it absolutely. */
  readonly bashHome: string;
}

const WINDOWS: Platform = {
  name: "Windows",
  system: windows({ variables: {}, homeDirectory: raw`C:\Users\office` }),
  home: raw`C:\Users\office`,
  worktree: raw`C:\Users\office\AppData\Local\the-office\worktrees\shop\task-1`,
  otherWorktree: raw`C:\Users\office\AppData\Local\the-office\worktrees\shop\task-2`,
  skillsFolder: raw`C:\Users\office\AppData\Local\the-office\sessions\s-1\skills`,
  dataDirectory: raw`C:\Users\office\AppData\Local\the-office`,
  officeEnvFile: raw`D:\Apps\the-office\.env`,
  systemFile: raw`C:\Windows\win.ini`,
  dialects: ["bash", "powershell"],
  bashHome: "/c/Users/office",
};

const LINUX: Platform = {
  name: "Linux",
  system: linux({ variables: {}, homeDirectory: "/home/office" }),
  home: "/home/office",
  worktree: "/home/office/.local/share/the-office/worktrees/shop/task-1",
  otherWorktree: "/home/office/.local/share/the-office/worktrees/shop/task-2",
  skillsFolder: "/home/office/.local/share/the-office/sessions/s-1/skills",
  dataDirectory: "/home/office/.local/share/the-office",
  officeEnvFile: "/opt/the-office/.env",
  systemFile: "/etc/passwd",
  dialects: ["bash"],
  bashHome: "/home/office",
};

const DEVELOPER: PermissionProfile = {
  edit: true,
  run: { kind: "anything" },
  web: true,
  mcpTools: {},
};

/** How a session's rules differ from a Task's Developer's in its worktree. */
interface SessionReach {
  readonly profile?: PermissionProfile;
  readonly workstation?: boolean;
  readonly refusalAdvice?: string;
}

/** A chat's: it only reads (spec §6). */
const READ_ONLY: PermissionProfile = {
  edit: false,
  run: { kind: "read-only-git" },
  web: true,
  mcpTools: {},
};

function rulesOn(
  platform: Platform,
  { profile = DEVELOPER, workstation = false, refusalAdvice }: SessionReach = {},
): OfficeRules {
  const { paths } = platform.system;
  return new OfficeRules({
    workingFolder: workstation ? platform.home : platform.worktree,
    readableFolders: [platform.skillsFolder],
    profile,
    workstation,
    // As the engine names them: the user's, then The Office's.
    secrets: [
      ...platform.system.secretPaths,
      paths.join(platform.dataDirectory, "engines"),
      paths.join(platform.dataDirectory, "identity"),
      platform.officeEnvFile,
    ],
    officeFiles: [platform.dataDirectory],
    cloneFolders: [paths.join(platform.dataDirectory, "repositories")],
    homeFolder: platform.home,
    environment:
      platform === WINDOWS
        ? { USERPROFILE: platform.home, APPDATA: raw`C:\Users\office\AppData\Roaming` }
        : { HOME: platform.home },
    paths,
    refusalAdvice,
  });
}

const command = (dialect: ShellDialect, commandLine: string): AgentAction => ({
  kind: "command",
  dialect,
  commandLine,
});

describe.each([WINDOWS, LINUX])("OfficeRules on $name paths", (platform) => {
  const rules = rulesOn(platform);
  const decide = (action: AgentAction) => rules.decide(action);
  const join = (...names: string[]) => platform.system.paths.join(...names);

  describe.each(platform.dialects)("git, in %s", (dialect) => {
    it.each([
      "git commit -m 'work'",
      "git push origin HEAD",
      "git -C sub checkout main",
      "git -c core.pager=less log",
      "git log --output=log.txt",
      "npm test && git add .",
      dialect === "bash" ? `bash -c "git reset --hard"` : `Invoke-Expression "git reset --hard"`,
      dialect === "bash" ? "echo $(git stash)" : "& git.exe stash",
    ])("refuses %s", (commandLine) => {
      expect(decide(command(dialect, commandLine))).toEqual({
        allowed: false,
        reason: expect.stringMatching(/^Refused by The Office: Agents never change git \(git /),
      });
    });

    it.each([
      "git status",
      "git diff HEAD~1 -- src",
      "git log --oneline -5",
      "git -C sub show HEAD:README.md",
      "git --version",
      `grep -rn "git commit" .`,
      `echo "git push"`,
      "npm run git-hooks",
    ])("allows %s", (commandLine) => {
      expect(decide(command(dialect, commandLine))).toEqual({ allowed: true });
    });
  });

  describe.each(platform.dialects)("the container runtime, in %s", (dialect) => {
    it.each([
      "docker ps",
      "docker compose up -d",
      "/usr/bin/docker run --rm -v /:/host alpine",
      "docker-compose down",
      "podman run alpine",
      "podman-compose up",
      "nerdctl ps",
      "npm test && docker exec db psql",
      "curl --unix-socket /var/run/docker.sock http://localhost/containers/json",
      "ls -l /run/podman/podman.sock",
      dialect === "bash" ? `bash -c "docker ps"` : `Invoke-Expression "docker ps"`,
      ...(dialect === "bash"
        ? [
            "sudo docker ps",
            "DOCKER_HOST=tcp://localhost:2375 npm test",
            "export DOCKER_HOST=unix:///var/run/docker.sock",
            "env CONTAINER_HOST=ssh://host npm test",
          ]
        : ["docker.exe ps"]),
    ])("refuses %s", (commandLine) => {
      expect(decide(command(dialect, commandLine))).toEqual({
        allowed: false,
        reason: expect.stringMatching(
          /^Refused by The Office: Agents never reach the container runtime \(\S+\), which would reach the whole workstation/,
        ),
      });
    });

    it.each([
      "npm run verify:linux",
      "cat docker-compose.yml",
      `echo "docker ps"`,
      "npm run docker",
    ])("allows %s, which names the runtime only in its arguments", (commandLine) => {
      expect(decide(command(dialect, commandLine))).toEqual({ allowed: true });
    });

    it("refuses it in a chat, before its profile", () => {
      const chat = rulesOn(platform, { profile: READ_ONLY });
      expect(chat.decide(command(dialect, "docker ps"))).toEqual({
        allowed: false,
        reason: expect.stringMatching(
          /^Refused by The Office: Agents never reach the container runtime \(docker\)/,
        ),
      });
    });
  });

  describe.each(platform.dialects)("secrets in commands, in %s", (dialect) => {
    it.each([
      `cat ~/.ssh/id_ed25519`,
      `cat "${platform.bashHome}/.aws/credentials"`,
      `cd ~ && cat .ssh/id_ed25519`,
      // Quoted, since an unquoted backslash escapes in Bash.
      `cat '${join(platform.home, ".claude", ".credentials.json")}'`,
      `cat '${join(platform.dataDirectory, "settings.json")}'`,
      `cat '${join(platform.dataDirectory, "identity", "office_ed25519")}'`,
      // An engine's config folder, which holds its account, is The Office's own.
      `cat '${join(platform.dataDirectory, "engines", "claude-code", ".credentials.json")}'`,
      `ls '${join(platform.dataDirectory, "engines")}'`,
      `ls '${platform.dataDirectory}'`,
      `cat '${join(platform.otherWorktree, "src", "app.ts")}'`,
      `cat '${platform.officeEnvFile}'`,
      `ssh -i ~/.ssh/id_ed25519 host`,
      `tool --key-file=~/.ssh/id_ed25519`,
      `npm test < ~/.aws/config`,
    ])("refuses %s", (commandLine) => {
      expect(decide(command(dialect, commandLine))).toMatchObject({
        allowed: false,
        reason: expect.stringContaining("holds the user's secrets or The Office's own files"),
      });
    });

    it.each([
      "cat README.md",
      "cat .env",
      `cat '${join(platform.worktree, "src", "app.ts")}'`,
      `cat '${join(platform.skillsFolder, "review", "SKILL.md")}'`,
      // A Project's clone is read as a path-added Project's folder is.
      `cat '${join(platform.dataDirectory, "repositories", "github.com", "acme", "shop", "README.md")}'`,
      "ssh -T git@github.com",
    ])("allows %s", (commandLine) => {
      expect(decide(command(dialect, commandLine))).toEqual({ allowed: true });
    });
  });

  describe.each(platform.dialects)("paths after a cd, in %s", (dialect) => {
    /** The data directory as a path from the home folder, which a `cd ~` makes relative. */
    const dataFromHome =
      platform === WINDOWS ? "AppData/Local/the-office" : ".local/share/the-office";

    it.each([
      "cd apps/web/src && cat ../../../README.md",
      "cd apps/web/src && cd ../../.. && cat README.md",
      "cd apps/web; cat ../../package.json",
      `cd '${join(platform.worktree, "apps", "web")}' && cat ../../README.md`,
      ...(dialect === "powershell"
        ? ["Set-Location apps/web/src; Get-Content ../../../README.md"]
        : ["pushd apps/web/src && cat ../../../README.md"]),
    ])("reads relative paths from where the cd went: allows %s", (commandLine) => {
      expect(decide(command(dialect, commandLine))).toEqual({ allowed: true });
    });

    it.each([
      "cd apps/web/src && cat ../../../../settings.json",
      `cd ~ && cat ${dataFromHome}/settings.json`,
      "cd .. && cat task-2/src/app.ts",
      // A cd that may not last, in a subshell or a pipeline, leaves the worktree a place to read from.
      "(cd apps/web/src) && cat ../../../settings.json",
      "cd apps/web/src | cat ../../../settings.json",
      "cat $(cd apps/web/src) ../../../settings.json",
    ])("refuses %s", (commandLine) => {
      expect(decide(command(dialect, commandLine))).toMatchObject({
        allowed: false,
        reason: expect.stringContaining("holds the user's secrets or The Office's own files"),
      });
    });
  });

  it.runIf(platform === WINDOWS)(
    "refuses secrets named by PowerShell's and cmd.exe's variables",
    () => {
      for (const commandLine of [
        raw`Get-Content $env:USERPROFILE\.ssh\id_ed25519`,
        'Get-Content "${env:APPDATA}\\GitHub CLI\\hosts.yml"',
        raw`cmd /c type %USERPROFILE%\.aws\credentials`,
        raw`Get-Content $HOME\.claude\.credentials.json`,
      ]) {
        expect(decide(command("powershell", commandLine))).toMatchObject({ allowed: false });
      }
    },
  );

  describe("reading files", () => {
    it.each([
      ["a file in the worktree", "src/app.ts"],
      ["the worktree's .env", ".env"],
      ["a file of its skills", join(platform.skillsFolder, "review", "SKILL.md")],
    ])("allows %s", (_, path) => {
      expect(decide({ kind: "read", paths: [path] })).toEqual({ allowed: true });
    });

    it.each([
      ["SSH keys", join(platform.home, ".ssh", "id_ed25519")],
      ["SSH keys named from the home folder", "~/.ssh/id_ed25519"],
      ["another Task's worktree", join(platform.otherWorktree, "src", "app.ts")],
      ["The Office's database credentials", platform.officeEnvFile],
    ])("refuses %s as a secret", (_, path) => {
      expect(decide({ kind: "read", paths: [path] })).toMatchObject({
        allowed: false,
        reason: expect.stringContaining("holds the user's secrets"),
      });
    });

    it("refuses a file outside the session's folders", () => {
      expect(decide({ kind: "read", paths: [platform.systemFile] })).toEqual({
        allowed: false,
        reason: `Refused by The Office: ${platform.systemFile} is outside this session's folders; read only inside ${platform.worktree}.`,
      });
      expect(decide({ kind: "read", paths: [".", "../.."] })).toMatchObject({ allowed: false });
    });

    it("refuses another Project's clone as outside the session's folders, not as The Office's own", () => {
      const clone = join(platform.dataDirectory, "repositories", "github.com", "acme", "shop");
      expect(decide({ kind: "read", paths: [clone] })).toEqual({
        allowed: false,
        reason: `Refused by The Office: ${clone} is outside this session's folders; read only inside ${platform.worktree}.`,
      });
    });

    it.runIf(platform === WINDOWS)("reads a Git Bash path as the Windows path it names", () => {
      expect(decide({ kind: "read", paths: ["/c/Users/office/.ssh/id_ed25519"] })).toMatchObject({
        allowed: false,
      });
    });
  });

  describe("editing files", () => {
    it.each([
      "src/app.ts",
      ".github/workflows/ci.yml",
      ".gitignore",
      join(platform.worktree, "docs", "plan.md"),
    ])("allows %s", (path) => {
      expect(decide({ kind: "edit", paths: [path] })).toEqual({ allowed: true });
    });

    it.each([".git", ".git/config", "packages/web/.claude/settings.json", ".mcp.json"])(
      "refuses the protected %s",
      (path) => {
        expect(decide({ kind: "edit", paths: [path] })).toEqual({
          allowed: false,
          reason:
            "Refused by The Office: .git, .claude and .mcp.json are The Office's to change; Agents never write there.",
        });
      },
    );

    it.runIf(platform === WINDOWS)("refuses a protected path in any case on Windows", () => {
      expect(decide({ kind: "edit", paths: [raw`.GIT\config`] })).toMatchObject({ allowed: false });
    });

    it("refuses a file outside the worktree, its skills folder too", () => {
      for (const path of [platform.systemFile, join(platform.skillsFolder, "review", "SKILL.md")]) {
        expect(decide({ kind: "edit", paths: [path] })).toMatchObject({
          allowed: false,
          reason: expect.stringContaining("is outside the worktree; edit only inside"),
        });
      }
    });
  });

  describe("the permission profile", () => {
    const reviewer = rulesOn(platform, {
      profile: {
        edit: false,
        run: {
          kind: "project-commands",
          commandLines: ["npm test", "npm run lint && npm run typecheck"],
        },
        web: false,
        mcpTools: {},
      },
    });
    const planner = rulesOn(platform, { profile: READ_ONLY });

    it("refuses edits and the web where the profile has none", () => {
      expect(reviewer.decide({ kind: "edit", paths: ["src/app.ts"] })).toEqual({
        allowed: false,
        reason: "Not allowed in this session: editing files.",
      });
      expect(reviewer.decide({ kind: "web" })).toEqual({
        allowed: false,
        reason: "Not allowed in this session: searching or fetching the web.",
      });
      expect(planner.decide({ kind: "web" })).toEqual({ allowed: true });
    });

    describe.each(platform.dialects)("commands, in %s", (dialect) => {
      it("runs only read-only git for read-only git", () => {
        expect(planner.decide(command(dialect, "git log -3 && git status"))).toEqual({
          allowed: true,
        });
        for (const commandLine of ["npm test", "git log | sort", "ls"]) {
          expect(planner.decide(command(dialect, commandLine))).toMatchObject({
            allowed: false,
            reason: expect.stringContaining(
              "Not allowed in this session: commands other than read-only git",
            ),
          });
        }
      });

      it("says a pipe is refused too, and to read and search with Read and Grep", () => {
        expect(planner.decide(command(dialect, "git show HEAD:README.md | head -20"))).toEqual({
          allowed: false,
          reason:
            "Not allowed in this session: commands other than read-only git (status, diff, log, show), alone or in a pipe; read files with Read and search them with Grep instead.",
        });
      });

      it("runs the Project's own commands, with more arguments, and read-only git", () => {
        for (const commandLine of [
          "npm test",
          "npm test -- --grep cart",
          "npm run typecheck",
          "git diff && npm run lint",
          dialect === "bash" ? "npm test > /dev/null 2>&1" : "npm test > $null",
        ]) {
          expect(reviewer.decide(command(dialect, commandLine))).toEqual({ allowed: true });
        }
        for (const commandLine of ["npm testx", "npm install", "npm test; rm -rf src"]) {
          expect(reviewer.decide(command(dialect, commandLine))).toMatchObject({
            allowed: false,
            reason: expect.stringContaining(
              "commands other than the Project's own (npm test; npm run lint && npm run typecheck)",
            ),
          });
        }
      });

      it("refuses writing a command's output to a file unless commands are free", () => {
        expect(reviewer.decide(command(dialect, "npm test > results.txt"))).toEqual({
          allowed: false,
          reason: "Not allowed in this session: writing a command's output to a file.",
        });
        expect(decide(command(dialect, "npm test > results.txt"))).toEqual({ allowed: true });
      });

      it("refuses writing a command's output outside the worktree, naming the rule", () => {
        expect(decide(command(dialect, "npm test > /tmp/results.txt"))).toEqual({
          allowed: false,
          reason: `Refused by The Office: /tmp/results.txt is outside the worktree, and writes outside it are refused; keep a command's output in the shell, or write it inside ${platform.worktree}.`,
        });
        expect(decide(command(dialect, "npm test > ../task-2/results.txt"))).toMatchObject({
          allowed: false,
        });
        expect(decide(command(dialect, "npm test > out/results.txt"))).toEqual({ allowed: true });
      });
    });
  });

  it("refuses a command it can't read, and a tool The Office doesn't give", () => {
    expect(decide(command(platform.dialects.at(-1) ?? "bash", "pwsh -enc ZwBpAHQA"))).toMatchObject(
      {
        allowed: false,
        reason: expect.stringContaining("-EncodedCommand"),
      },
    );
    expect(decide({ kind: "unavailable", tool: "RemoteTrigger" })).toEqual({
      allowed: false,
      reason: "Not available in The Office: the RemoteTrigger tool.",
    });
    expect(decide({ kind: "engine" })).toEqual({ allowed: true });
    expect(decide({ kind: "office-tool" })).toEqual({ allowed: true });
  });
});

const mcpCall = (tool: string): AgentAction => ({ kind: "mcp-tool", server: "github", tool });

describe("OfficeRules on MCP tools", () => {
  const rules = rulesOn(LINUX, {
    profile: {
      ...DEVELOPER,
      mcpTools: {
        "github/list_issues": { kind: "allowed" },
        "github/create_issue": { kind: "consult", role: "devops" },
        "github/merge": { kind: "ask-me" },
        "github/delete_repo": { kind: "never" },
      },
    },
  });

  it("runs an Allowed tool", () => {
    expect(rules.decide(mcpCall("list_issues"))).toEqual({ allowed: true });
  });

  it("refuses a tool set to Never in the rules' words", () => {
    expect(rules.decide(mcpCall("delete_repo"))).toEqual({
      allowed: false,
      reason: "Not allowed in this session: the github/delete_repo MCP tool.",
    });
  });

  it.each([
    ["create_issue", { kind: "consult", role: "devops" }],
    ["merge", { kind: "ask-me" }],
  ])("leaves %s to the approval its setting asks for", (tool, setting) => {
    expect(rules.decide(mcpCall(tool))).toMatchObject({ allowed: false, approval: setting });
  });

  it("refuses a tool of no server the session was given", () => {
    expect(rules.decide(mcpCall("unknown"))).toEqual({
      allowed: false,
      reason: "Not available in The Office: the github/unknown MCP tool.",
    });
  });
});

const ALLOW_CHANGES = "Ask the user to Allow changes in this Thread to change anything.";

describe.each([WINDOWS, LINUX])("OfficeRules of the Caretaker on $name paths", (platform) => {
  const join = (...names: string[]) => platform.system.paths.join(...names);
  const readOnly = rulesOn(platform, { profile: READ_ONLY, refusalAdvice: ALLOW_CHANGES });
  const workstation = rulesOn(platform, { workstation: true });
  const dialect = platform.dialects[0] ?? "bash";

  /** Every secret the engine names, as a file inside it. */
  const secrets = [
    join(platform.home, ".ssh", "id_ed25519"),
    join(platform.home, ".claude", ".credentials.json"),
    join(platform.home, ".aws", "credentials"),
    join(platform.dataDirectory, "engines", "claude-code", ".credentials.json"),
    join(platform.dataDirectory, "identity", "office_ssh_key"),
    platform.officeEnvFile,
    ...platform.system.secretPaths.map((secret) => join(secret, "file")),
  ];

  describe("while changes aren't allowed", () => {
    it.each([
      ["an edit", { kind: "edit", paths: ["src/app.ts"] }],
      ["a command", command(dialect, "npm install")],
      ["a git change", command(dialect, "git commit -m 'fix'")],
      ["the container runtime", command(dialect, "docker ps")],
      ["a read outside its folders", { kind: "read", paths: [platform.systemFile] }],
    ] as const)("refuses %s, telling the Agent to ask the user", (_, action) => {
      expect(readOnly.decide(action)).toEqual({
        allowed: false,
        reason: expect.stringMatching(/ Ask the user to Allow changes in this Thread/),
      });
    });

    it("reads as a chat does", () => {
      expect(readOnly.decide({ kind: "read", paths: ["README.md"] })).toEqual({ allowed: true });
      expect(readOnly.decide(command(dialect, "git log -3"))).toEqual({ allowed: true });
      expect(readOnly.decide({ kind: "web" })).toEqual({ allowed: true });
    });

    it("refuses a secret without the advice, as allowing changes would not change it", () => {
      expect(readOnly.decide({ kind: "read", paths: ["~/.ssh/id_ed25519"] })).toEqual({
        allowed: false,
        reason: expect.not.stringContaining("Allow changes"),
      });
    });
  });

  describe("with changes allowed", () => {
    it.each([
      ["a system file", platform.systemFile],
      ["The Office's data folder", join(platform.dataDirectory, "settings.json")],
      ["a worktree's .git", join(platform.worktree, ".git", "config")],
      ["a worktree's .claude", join(platform.worktree, ".claude", "settings.json")],
      ["a worktree's .mcp.json", join(platform.worktree, ".mcp.json")],
      ["the user's own Claude settings", join(platform.home, ".claude", "settings.json")],
      ["a file in the home folder", "notes.txt"],
    ])("reads and edits %s", (_, path) => {
      expect(workstation.decide({ kind: "read", paths: [path] })).toEqual({ allowed: true });
      expect(workstation.decide({ kind: "edit", paths: [path] })).toEqual({ allowed: true });
    });

    it.each(platform.dialects)(
      "runs any command, every git command and the container runtime included, in %s",
      (shell) => {
        for (const commandLine of [
          "npm install -g pnpm",
          "git commit -am 'fix'",
          "git push origin HEAD",
          `git -C '${platform.worktree}' reset --hard`,
          `ls '${platform.dataDirectory}'`,
          "npm test > /tmp/results.txt",
          "docker compose ps",
          "podman ps",
          "curl --unix-socket /var/run/docker.sock http://localhost/version",
        ]) {
          expect(workstation.decide(command(shell, commandLine))).toEqual({ allowed: true });
        }
      },
    );

    it.each(secrets)("refuses reading, editing and naming in a command %s", (secret) => {
      const refusal = {
        allowed: false,
        reason: expect.stringContaining("holds secrets, which Agents never read or change"),
      };
      expect(workstation.decide({ kind: "read", paths: [secret] })).toEqual(refusal);
      expect(workstation.decide({ kind: "edit", paths: [secret] })).toEqual(refusal);
      expect(workstation.decide(command(dialect, `cat '${secret}'`))).toEqual(refusal);
    });

    it("refuses secrets named from its working folder, the home folder", () => {
      for (const commandLine of ["cat .ssh/id_ed25519", "cd ~ && cat .aws/credentials"]) {
        expect(workstation.decide(command(dialect, commandLine))).toMatchObject({
          allowed: false,
        });
      }
      expect(workstation.decide({ kind: "read", paths: [".ssh"] })).toMatchObject({
        allowed: false,
      });
    });
  });
});
