import type { McpServer, ServerValue } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  connectionLine,
  draftOfServer,
  mcpServerEditOf,
  newMcpServerOf,
  secretOnSave,
  serverValuesLine,
  withSecret,
} from "./mcp-server-draft.ts";

const TOKEN: ServerValue = {
  name: "GITHUB_TOKEN",
  secret: true,
  required: true,
  officeWideValueSet: true,
};

const OWNER: ServerValue = {
  name: "GITHUB_OWNER",
  secret: false,
  required: false,
  officeWideValue: "acme",
  officeWideValueSet: true,
};

const GITHUB: McpServer = {
  name: "github",
  transport: "stdio",
  command: "npx",
  arguments: ["-y", "@acme/github mcp"],
  serverValues: [TOKEN, OWNER],
  state: "on",
  tools: [],
  roles: [],
  addedAt: "2026-10-31T09:00:00.000Z",
};

describe("Settings › MCP servers' draft", () => {
  it("starts from a kept server with each plain value shown and each secret kept", () => {
    const draft = draftOfServer(GITHUB);

    expect(draft.argumentLines).toBe("-y\n@acme/github mcp");
    expect(mcpServerEditOf(draft)).toEqual({
      transport: "stdio",
      command: "npx",
      arguments: ["-y", "@acme/github mcp"],
      serverValues: [
        { name: "GITHUB_TOKEN", secret: true, required: true },
        { name: "GITHUB_OWNER", secret: false, required: false, officeWideValue: "acme" },
      ],
    });
  });

  it("takes one argument per line, leaving blank lines out, and saves only the chosen connection", () => {
    const draft = {
      ...draftOfServer(GITHUB),
      name: " github ",
      argumentLines: "-y\r\n\r\n--root\n  ",
      url: "https://mcp.example.com",
    };

    expect(newMcpServerOf(draft)).toMatchObject({
      name: "github",
      transport: "stdio",
      arguments: ["-y", "--root"],
    });
    expect(mcpServerEditOf({ ...draft, transport: "streamable-http" })).toEqual({
      transport: "streamable-http",
      url: "https://mcp.example.com",
      serverValues: expect.any(Array),
    });
  });

  it("says what saving does with a secret's value", () => {
    const kept = { name: "GITHUB_TOKEN", secret: true, required: true };

    expect(secretOnSave(kept, TOKEN)).toBe("kept-set");
    expect(secretOnSave(kept, undefined)).toBe("kept-none");
    expect(secretOnSave({ ...kept, officeWideValue: "ghp_new" }, TOKEN)).toBe("new");
    expect(secretOnSave({ ...kept, officeWideValue: "" }, TOKEN)).toBe("removed");
    expect(secretOnSave({ ...kept, officeWideValue: "" }, undefined)).toBe("kept-none");
    // A plain value made secret keeps no secret: its text in the field is what is saved.
    expect(secretOnSave(kept, OWNER)).toBe("kept-none");
  });

  it("starts a secret made plain empty, since its value is never shown", () => {
    expect(withSecret({ name: "GITHUB_TOKEN", secret: true, required: true }, false)).toEqual({
      name: "GITHUB_TOKEN",
      secret: false,
      required: true,
      officeWideValue: "",
    });
  });

  it("shows how a server runs in one line", () => {
    expect(connectionLine(GITHUB)).toBe('npx -y "@acme/github mcp"');
    expect(
      connectionLine({
        ...GITHUB,
        transport: "streamable-http",
        url: "https://mcp.example.com/mcp",
      }),
    ).toBe("https://mcp.example.com/mcp");
  });

  it("names the required values with no Office-wide value", () => {
    expect(serverValuesLine([])).toBe("None");
    expect(serverValuesLine([TOKEN, OWNER])).toBe("2 Server values");
    expect(serverValuesLine([{ ...TOKEN, officeWideValueSet: false }])).toBe(
      "1 Server value · GITHUB_TOKEN not set Office-wide",
    );
  });
});
