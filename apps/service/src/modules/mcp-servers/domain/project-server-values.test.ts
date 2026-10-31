import { describe, expect, it } from "vitest";
import { anMcpServer } from "./mcp-server.fixtures.js";
import { McpServerRefused } from "./mcp-server-refused.js";
import {
  editedProjectServerValues,
  missingRequiredValues,
  projectServerValuesAfterChange,
  serverValuesFor,
  type ProjectServerValue,
} from "./project-server-values.js";

const server = anMcpServer();

function projectValue(changes: Partial<ProjectServerValue> = {}): ProjectServerValue {
  return {
    projectId: "admin-panel",
    serverName: "github",
    name: "GITHUB_TOKEN",
    value: "project-token",
    secret: true,
    ...changes,
  };
}

describe("editedProjectServerValues", () => {
  it("sets, keeps and clears the Project's values", () => {
    const kept = [projectValue()];

    expect(
      editedProjectServerValues(server, "admin-panel", kept, [
        { name: "GITHUB_TOKEN" },
        { name: "GITHUB_HOST", projectValue: "github.example.com" },
      ]),
    ).toEqual([
      projectValue(),
      projectValue({ name: "GITHUB_HOST", value: "github.example.com", secret: false }),
    ]);
    expect(
      editedProjectServerValues(server, "admin-panel", kept, [
        { name: "GITHUB_TOKEN", projectValue: "" },
      ]),
    ).toEqual([]);
    expect(editedProjectServerValues(server, "admin-panel", kept, [])).toEqual([]);
  });

  it("refuses a name that isn't a Server value, or one given twice", () => {
    let refused: unknown;
    try {
      editedProjectServerValues(
        server,
        "admin-panel",
        [],
        [
          { name: "TOKEN", projectValue: "x" },
          { name: "GITHUB_HOST", projectValue: "a" },
          { name: "GITHUB_HOST", projectValue: "b" },
        ],
      );
    } catch (error) {
      refused = error;
    }

    expect(refused).toBeInstanceOf(McpServerRefused);
    expect((refused as McpServerRefused).reasons).toEqual([
      `"TOKEN" is not a Server value of "github".`,
      `"GITHUB_HOST" is given more than once.`,
    ]);
  });
});

describe("serverValuesFor", () => {
  it("takes the Project's value over the Office-wide one, leaving out a value with neither", () => {
    expect(serverValuesFor(server, [])).toEqual({ GITHUB_TOKEN: "office-token" });
    expect(serverValuesFor(server, [projectValue()])).toEqual({ GITHUB_TOKEN: "project-token" });
    expect(serverValuesFor(server, [projectValue({ serverName: "linear" })])).toEqual({
      GITHUB_TOKEN: "office-token",
    });
  });

  it("ignores a value saved as a secret that is plain now", () => {
    const plain = anMcpServer({
      serverValues: [{ name: "GITHUB_TOKEN", secret: false, required: true }],
    });

    expect(serverValuesFor(plain, [projectValue()])).toEqual({});
  });
});

describe("missingRequiredValues", () => {
  it("names each required value with none", () => {
    const unset = anMcpServer({
      serverValues: [
        { name: "GITHUB_TOKEN", secret: true, required: true },
        { name: "GITHUB_HOST", secret: false, required: false },
      ],
    });

    expect(missingRequiredValues(unset, {})).toEqual(["GITHUB_TOKEN"]);
    expect(missingRequiredValues(unset, { GITHUB_TOKEN: "x" })).toEqual([]);
  });
});

describe("projectServerValuesAfterChange", () => {
  it("drops a value whose Server value is gone, or a secret's made plain", () => {
    const changed = anMcpServer({
      serverValues: [
        { name: "GITHUB_TOKEN", secret: false, required: true },
        { name: "GITHUB_HOST", secret: true, required: false },
      ],
    });
    const kept = [
      projectValue(),
      projectValue({ name: "GITHUB_HOST", value: "github.example.com", secret: false }),
      projectValue({ name: "GITHUB_ORG", value: "acme", secret: false }),
    ];

    expect(projectServerValuesAfterChange(changed, kept)).toEqual([
      projectValue({ name: "GITHUB_HOST", value: "github.example.com", secret: true }),
    ]);
  });
});
