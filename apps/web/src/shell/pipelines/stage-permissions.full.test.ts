import { describe, expect, it } from "vitest";
import type { AgentStage } from "./stage-edits.ts";
import { withRole } from "./stage-edits.ts";
import {
  narrowerRuns,
  narrowerSettings,
  withCommands,
  withMcpToolSetting,
  withPermissions,
} from "./stage-permissions.ts";

const implement: AgentStage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Implement the Plan.",
  session: "fresh",
  budget: 250_000,
};

describe("a Stage's permissions", () => {
  it("offers only the run permissions narrower than the card's", () => {
    expect(narrowerRuns("anything")).toEqual(["read-only-git", "project-commands"]);
    expect(narrowerRuns("read-only-git")).toEqual([]);
  });

  it("offers only the MCP tool settings narrower than the card's", () => {
    expect(narrowerSettings({ kind: "allowed" }, ["reviewer"])).toEqual([
      { kind: "consult", role: "reviewer" },
      { kind: "ask-me" },
      { kind: "never" },
    ]);
    expect(narrowerSettings({ kind: "consult", role: "devops" }, ["reviewer"])).toEqual([
      { kind: "ask-me" },
      { kind: "never" },
    ]);
    expect(narrowerSettings({ kind: "never" }, ["reviewer"])).toEqual([]);
  });

  it("keeps only what the Stage states, and nothing once it states nothing", () => {
    const narrowed = withPermissions(implement, { edit: false, run: "read-only-git" });
    expect(narrowed.permissions).toEqual({ edit: false, run: "read-only-git" });
    expect(withPermissions(narrowed, { edit: undefined, run: undefined })).toEqual(implement);
  });

  it("sets an MCP tool and puts it back at the card's", () => {
    const narrowed = withMcpToolSetting(implement, "github/merge", { kind: "never" });
    expect(narrowed.permissions).toEqual({ mcpTools: { "github/merge": { kind: "never" } } });
    expect(withMcpToolSetting(narrowed, "github/merge", undefined)).toEqual(implement);
  });

  it("keeps only the Project commands listed, and the Role card's once none is", () => {
    const narrowed = withCommands(withPermissions(implement, { web: false }), ["test", "lint"]);
    expect(narrowed.permissions).toEqual({ web: false, commands: ["test", "lint"] });
    expect(withCommands(narrowed, []).permissions).toEqual({ web: false });
    expect(withCommands(withCommands(implement, ["test"]), [])).toEqual(implement);
  });

  it("drops the MCP tools set when another Role works the Stage", () => {
    const narrowed = withPermissions(
      withMcpToolSetting(implement, "github/merge", { kind: "never" }),
      { web: false },
    );
    expect(withRole([narrowed], 0, "reviewer")).toEqual({
      ...implement,
      role: "reviewer",
      permissions: { web: false },
    });
  });
});
