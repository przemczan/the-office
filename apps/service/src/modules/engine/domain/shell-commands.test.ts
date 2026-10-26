import { describe, expect, it } from "vitest";
import {
  programName,
  programWords,
  simpleCommands,
  UnreadableCommand,
  type ShellDialect,
} from "./shell-commands.js";

/** Each simple command's program and arguments. */
function programs(commandLine: string, dialect: ShellDialect): string[][] {
  return simpleCommands(commandLine, dialect).map((command) => [...programWords(command, dialect)]);
}

const bash = (commandLine: string) => programs(commandLine, "bash");
const powerShell = (commandLine: string) => programs(commandLine, "powershell");

describe("simpleCommands in Bash", () => {
  it("splits lists and pipelines, with quotes removed", () => {
    expect(
      bash(`git status && git commit -m "first try" | tee log; echo 'a b' || exit 1 & wait`),
    ).toEqual([
      ["git", "status"],
      ["git", "commit", "-m", "first try"],
      ["tee", "log"],
      ["echo", "a b"],
      ["exit", "1"],
      ["wait"],
    ]);
  });

  it("reads escapes, line continuations and comments as Bash does", () => {
    expect(bash("git com\\mit \\\n  --amend # git push")).toEqual([["git", "commit", "--amend"]]);
  });

  it("reads the commands of substitutions, subshells and groups", () => {
    expect(
      bash('echo "$(git commit)" `git push` && ( cd sub && git tag v1 ) && { git rm x; }'),
    ).toEqual(
      expect.arrayContaining([
        ["git", "commit"],
        ["git", "push"],
        ["git", "tag", "v1"],
        ["git", "rm", "x"],
      ]),
    );
    expect(bash("diff <(git show HEAD:a) b")).toEqual(
      expect.arrayContaining([["git", "show", "HEAD:a"]]),
    );
  });

  it("reads the scripts handed to another shell", () => {
    expect(bash(`bash -lc 'git commit -m "x"'`)).toContainEqual(["git", "commit", "-m", "x"]);
    expect(bash(`eval "git push"`)).toContainEqual(["git", "push"]);
    expect(bash(`cmd /c "git commit && git push"`)).toEqual(
      expect.arrayContaining([
        ["git", "commit"],
        ["git", "push"],
      ]),
    );
  });

  it("finds the program behind assignments and wrappers", () => {
    expect(bash("FOO=1 env -u X BAR=2 sudo -u root nice -n 5 git push")).toEqual([["git", "push"]]);
    expect(bash("find . -name '*.orig' | xargs -n 1 git rm")).toContainEqual(["git", "rm"]);
    expect(bash("timeout 10 git fetch")).toEqual([["git", "fetch"]]);
    expect(bash("if true; then git push; fi")).toContainEqual(["git", "push"]);
  });

  it("reads a here-document's body as data, not as commands", () => {
    expect(bash("cat <<'EOF' > notes.md\ngit commit\nEOF\necho done")).toEqual([
      ["cat"],
      ["echo", "done"],
    ]);
    expect(bash("cat <<-END\n\tgit push\n\tEND\nls")).toEqual([["cat"], ["ls"]]);
  });

  it("names where a command's streams go, without duplications", () => {
    expect(simpleCommands("npm test > out.txt 2>&1 < in.txt &>> all.log", "bash")).toEqual([
      {
        words: ["npm", "test"],
        redirects: [
          { target: "out.txt", writes: true },
          { target: "in.txt", writes: false },
          { target: "all.log", writes: true },
        ],
        inMainShell: true,
      },
    ]);
  });

  it("keeps a word that only mentions git as an argument", () => {
    expect(bash(`grep -rn "git commit" . && npm run git-hooks`)).toEqual([
      ["grep", "-rn", "git commit", "."],
      ["npm", "run", "git-hooks"],
    ]);
  });
});

describe("simpleCommands in PowerShell", () => {
  it("splits statements and pipelines, with PowerShell's quotes and escapes", () => {
    expect(powerShell("git status; git commit -m 'it''s' | Out-Null\ngit tag `\n  v1")).toEqual([
      ["git", "status"],
      ["git", "commit", "-m", "it's"],
      ["Out-Null"],
      ["git", "tag", "v1"],
    ]);
  });

  it("reads the call operator, subexpressions and script blocks", () => {
    expect(powerShell("& 'C:\\Program Files\\Git\\cmd\\git.exe' push")).toEqual([
      ["C:\\Program Files\\Git\\cmd\\git.exe", "push"],
    ]);
    expect(powerShell('Write-Output "$(git commit)"')).toContainEqual(["git", "commit"]);
    expect(powerShell("Get-ChildItem | ForEach-Object { git add $_ }")).toContainEqual([
      "git",
      "add",
      "$_",
    ]);
    expect(powerShell("<# git push #> git status")).toEqual([["git", "status"]]);
  });

  it("reads the commands Invoke-Expression, Start-Process, powershell and cmd run", () => {
    expect(powerShell(`Invoke-Expression "git push"`)).toContainEqual(["git", "push"]);
    expect(powerShell(`iex 'git commit -m x'`)).toContainEqual(["git", "commit", "-m", "x"]);
    expect(powerShell(`Start-Process git -ArgumentList 'commit -m x'`)).toEqual([
      ["git", "commit", "-m", "x"],
    ]);
    expect(
      powerShell(`powershell -NoProfile -ExecutionPolicy Bypass -Command "git push"`),
    ).toContainEqual(["git", "push"]);
    expect(powerShell(`cmd.exe /c "git commit"`)).toContainEqual(["git", "commit"]);
  });

  it("refuses to read an encoded command", () => {
    expect(() =>
      simpleCommands("pwsh -NoProfile -enc ZwBpAHQAIABwAHUAcwBoAA==", "powershell"),
    ).toThrow(UnreadableCommand);
  });

  it("names where a command's streams go", () => {
    expect(simpleCommands("npm test *> $null; git log > log.txt 2>&1", "powershell")).toEqual([
      { words: ["npm", "test"], redirects: [{ target: "$null", writes: true }], inMainShell: true },
      {
        words: ["git", "log"],
        redirects: [{ target: "log.txt", writes: true }],
        inMainShell: true,
      },
    ]);
  });

  it("tells which commands run in the command line's own shell", () => {
    expect(mainShellOf("cd a && ls; pwd || true")).toEqual([
      ["cd", true],
      ["ls", true],
      ["pwd", true],
      ["true", true],
    ]);
    expect(mainShellOf("cd a | cat & sleep 1")).toEqual([
      ["cd", false],
      ["cat", false],
      ["sleep", true],
    ]);
    expect(mainShellOf("(cd a) && echo $(cd b) `cd c`")).toEqual([
      ["cd", false],
      ["cd", false],
      ["cd", false],
      ["echo", true],
    ]);
    expect(mainShellOf(`bash -c "cd a"`)).toEqual([
      ["bash", true],
      ["cd", false],
    ]);
  });
});

describe("programName", () => {
  it("names a program without its folders, case or .exe", () => {
    expect(programName("C:\\Program Files\\Git\\cmd\\GIT.EXE")).toBe("git");
    expect(programName("/usr/bin/git")).toBe("git");
    expect(programName("git")).toBe("git");
  });
});

/** Each command's program, with whether it runs in the line's own shell. */
function mainShellOf(commandLine: string): (string | boolean | undefined)[][] {
  return simpleCommands(commandLine, "bash").map((command) => [
    command.words[0],
    command.inMainShell,
  ]);
}
