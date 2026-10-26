import { describe, expect, it } from "vitest";
import { directoryChange } from "./directory-change.js";
import { simpleCommands, type ShellDialect } from "./shell-commands.js";

function changeOf(commandLine: string, dialect: ShellDialect = "bash") {
  const [command] = simpleCommands(commandLine, dialect);
  if (command === undefined) throw new Error(`No command in ${commandLine}`);
  return directoryChange(command, dialect);
}

describe("directoryChange", () => {
  it.each([
    ["cd apps/web", "apps/web"],
    ["cd -P -- ../x", "../x"],
    ["pushd src", "src"],
    ["builtin cd src", "src"],
  ])("reads where %s goes in Bash", (commandLine, path) => {
    expect(changeOf(commandLine)).toEqual({ kind: "to", path });
  });

  it.each([
    ["Set-Location apps", "apps"],
    ["sl -LiteralPath 'my apps'", "my apps"],
    ["cd -Path src", "src"],
    ["Push-Location -StackName work src", "src"],
  ])("reads where %s goes in PowerShell", (commandLine, path) => {
    expect(changeOf(commandLine, "powershell")).toEqual({ kind: "to", path });
  });

  it("goes home on a bare cd in Bash, and doesn't follow cd -", () => {
    expect(changeOf("cd")).toEqual({ kind: "home" });
    expect(changeOf("cd -")).toEqual({ kind: "unknown" });
    expect(changeOf("Set-Location", "powershell")).toEqual({ kind: "unknown" });
  });

  it("leaves other commands where they are", () => {
    expect(changeOf("cat cd")).toEqual({ kind: "none" });
    expect(changeOf("echo cd src")).toEqual({ kind: "none" });
  });
});
