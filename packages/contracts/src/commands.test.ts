import { describe, expect, it } from "vitest";
import { messageCommand, officeCommandClash } from "./commands.js";

describe("messageCommand", () => {
  const skills = ["grill-me", "clear"];

  it("reads a skill command with its input", () => {
    expect(messageCommand("/grill-me the login page\nand its tests", skills)).toEqual({
      kind: "skill",
      name: "grill-me",
      input: "the login page\nand its tests",
    });
  });

  it("reads a skill command with no input", () => {
    expect(messageCommand("/grill-me", skills)).toEqual({
      kind: "skill",
      name: "grill-me",
      input: "",
    });
  });

  it("lets an Office command win over a skill of the same name", () => {
    expect(messageCommand("/clear", skills)).toEqual({ kind: "office", name: "clear" });
  });

  it("reads an Office command the Thread has no skills for", () => {
    expect(messageCommand("/help", [])).toEqual({ kind: "office", name: "help" });
  });

  it("takes a message whose first word is no command as an ordinary one", () => {
    expect(messageCommand("/deploy now", skills)).toBeUndefined();
    expect(messageCommand("/stop", skills)).toBeUndefined();
  });

  it("takes a '/' that isn't the first character as plain text", () => {
    expect(messageCommand(" /grill-me", skills)).toBeUndefined();
    expect(messageCommand("please run /grill-me", skills)).toBeUndefined();
    expect(messageCommand("/", skills)).toBeUndefined();
  });

  it("matches the first word exactly", () => {
    expect(messageCommand("/grill", skills)).toBeUndefined();
    expect(messageCommand("/helpme", skills)).toBeUndefined();
  });
});

describe("officeCommandClash", () => {
  it("names a skill an Office command's name takes", () => {
    expect(officeCommandClash("clear")).toBe(true);
    expect(officeCommandClash("help")).toBe(true);
    expect(officeCommandClash("grill-me")).toBe(false);
  });
});
