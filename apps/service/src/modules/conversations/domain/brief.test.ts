import { describe, expect, it } from "vitest";
import {
  CHAT_EXCHANGES_TOKENS,
  estimatedTokens,
  freshChatThreadBrief,
  newChatThreadBrief,
  type BriefProject,
} from "./brief.js";
import type { Message, MessageDraft } from "./message.js";

const PROJECTS: BriefProject[] = [
  { name: "Admin panel", baseBranch: "main", folder: "/office/bases/admin-panel" },
];

let position = 0;
function logged(draft: MessageDraft): Message {
  position += 1;
  return { ...draft, id: `m-${position}`, threadId: "t", at: new Date(2026, 9, 25, 10, position) };
}

const say = (text: string): Message => logged({ kind: "user", text });
const answer = (text: string): Message => logged({ kind: "person", roleKey: "planner", text });

describe("a new chat Thread's Brief", () => {
  it("says where each Project's base branch is, and nothing carries over", () => {
    const brief = newChatThreadBrief(PROJECTS);

    expect(brief.text).toContain("in a new Thread: nothing from your earlier Threads carries over");
    expect(brief.text).toContain(
      "- Admin panel: its main branch, read-only, at /office/bases/admin-panel",
    );
    expect(brief.tokens).toBe(estimatedTokens(brief.text));
  });

  it("says so when there is no Project", () => {
    expect(newChatThreadBrief([]).text).toContain("The Office works on no Project yet.");
  });
});

describe("a chat Thread's Brief when it continues fresh", () => {
  it("holds the title, the latest Handover note and the exchanges, without tool activity", () => {
    const log = [
      say("Read the deploy workflow."),
      logged({ kind: "tool-activity", roleKey: "planner", tool: "Read", summary: "deploy.yml" }),
      answer("It deploys on every push to main."),
      logged({ kind: "handover-note", roleKey: "planner", text: "Old note." }),
      logged({
        kind: "handover-note",
        roleKey: "planner",
        text: "Deploys explained; next: tests.",
      }),
      say("And the tests?"),
    ];

    const { text } = freshChatThreadBrief({ title: "Deploys", log, projects: PROJECTS });

    expect(text).toContain("## The Thread\n\nDeploys");
    expect(text).toContain("## Your Handover note\n\nDeploys explained; next: tests.");
    expect(text).not.toContain("Old note.");
    expect(text).toContain(
      "## The latest exchanges\n\nThe user: Read the deploy workflow.\n\nYou: It deploys on every push to main.\n\nThe user: And the tests?",
    );
    expect(text).not.toContain("deploy.yml");
    expect(text).toContain("## The Projects");
  });

  it("keeps the newest exchanges that fit under about 3k tokens", () => {
    const long = "x".repeat(CHAT_EXCHANGES_TOKENS * 2);
    const log = [say(`first ${long}`), answer(`second ${long}`), say("third")];

    const { text, tokens } = freshChatThreadBrief({ title: undefined, log, projects: [] });

    expect(text).toContain("The user: third");
    expect(text).toContain("You: second");
    expect(text).not.toContain("first");
    expect(text).not.toContain("## The Thread");
    expect(tokens).toBeLessThan(CHAT_EXCHANGES_TOKENS + 200);
  });

  it("keeps the end of a newest message that alone is over the cap", () => {
    const log = [say(`${"x".repeat(CHAT_EXCHANGES_TOKENS * 5)} the end`)];

    const { text } = freshChatThreadBrief({ title: "Long", log, projects: [] });

    expect(text).toContain("## The latest exchanges\n\n…");
    expect(text).toMatch(/x the end/);
  });
});
