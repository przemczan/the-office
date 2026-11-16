import { describe, expect, it } from "vitest";
import {
  CHAT_EXCHANGES_TOKENS,
  estimatedTokens,
  freshChatThreadBrief,
  initiativeThreadBrief,
  MEMORY_TOKENS,
  newChatThreadBrief,
  NO_MEMORY,
  selectMemory,
  taskThreadBrief,
  type BriefMemoryNote,
  type BriefProject,
} from "./brief.js";
import { oneOptionAnswer } from "./decision.js";
import { aDecision, THREE_QUESTIONS } from "./decision.fixtures.js";
import type { Message, MessageDraft } from "./message.js";
import { ANN_LEE } from "./user.fixtures.js";

const PROJECTS: BriefProject[] = [
  {
    projectId: "admin-panel",
    name: "Admin panel",
    baseBranch: "main",
    folder: "/office/bases/admin-panel",
  },
];

let position = 0;
function logged(draft: MessageDraft): Message {
  position += 1;
  return { ...draft, id: `m-${position}`, threadId: "t", at: new Date(2026, 9, 25, 10, position) };
}

const say = (text: string): Message =>
  logged({ kind: "user", text, delivery: "delivered", writtenBy: ANN_LEE });
const answer = (text: string): Message => logged({ kind: "person", roleKey: "planner", text });

describe("a new chat Thread's Brief", () => {
  it("says where each Project's base branch is, and nothing carries over", () => {
    const brief = newChatThreadBrief(PROJECTS, NO_MEMORY);

    expect(brief.text).toContain("in a new Thread: nothing from your earlier Threads carries over");
    expect(brief.text).toContain(
      "- Admin panel: its main branch, read-only, at /office/bases/admin-panel",
    );
    expect(brief.tokens).toBe(estimatedTokens(brief.text));
  });

  it("says so when there is no Project", () => {
    expect(newChatThreadBrief([], NO_MEMORY).text).toContain("The Office works on no Project yet.");
  });
});

/** The text of a Brief for a Thread on an Initiative reading `projects`. */
function initiativeBriefReading(projects: readonly BriefProject[]): string {
  return initiativeThreadBrief({
    record: "## The Initiative",
    continuing: false,
    memory: NO_MEMORY,
    projects,
  }).text;
}

describe("The Projects in a Brief for a Thread on an Initiative", () => {
  const SITE: BriefProject = {
    projectId: "site",
    name: "Site",
    baseBranch: "trunk",
    folder: "/office/bases/site",
  };
  const ADMIN_PANEL_ON_THE_BRANCH: BriefProject = {
    projectId: "admin-panel",
    name: "Admin panel",
    baseBranch: "main",
    folder: "/office/initiative-bases/sync/admin-panel",
    initiativeBranch: { branch: "initiative/sync", gone: false },
  };

  it("reads as a chat's, word for word, while every Project is read at its base branch", () => {
    const chat = newChatThreadBrief([...PROJECTS, SITE], NO_MEMORY).text;
    const projects = chat.slice(chat.indexOf("## The Projects"));

    expect(initiativeBriefReading([...PROJECTS, SITE]).endsWith(projects)).toBe(true);
    expect(projects).toBe(
      "## The Projects\n\nYou read each Project's base branch where it is checked out:\n\n- Admin panel: its main branch, read-only, at /office/bases/admin-panel\n- Site: its trunk branch, read-only, at /office/bases/site",
    );
  });

  it("names the Initiative's branch and its checkout where it is read, and the base branch elsewhere", () => {
    expect(initiativeBriefReading([ADMIN_PANEL_ON_THE_BRANCH, SITE])).toContain(
      "## The Projects\n\nYou read each Project where it is checked out:\n\n- Admin panel: the Initiative's branch initiative/sync, read-only, at /office/initiative-bases/sync/admin-panel\n- Site: its trunk branch, read-only, at /office/bases/site",
    );
  });

  it("says a deleted Initiative's branch is gone, so the base branch is read", () => {
    const gone: BriefProject = {
      ...SITE,
      initiativeBranch: { branch: "initiative/sync", gone: true },
    };

    expect(initiativeBriefReading([ADMIN_PANEL_ON_THE_BRANCH, gone])).toContain(
      "- Site: its trunk branch, read-only, at /office/bases/site; the Initiative's branch initiative/sync is gone, so you read the base branch.",
    );
    expect(initiativeBriefReading([gone])).toContain(
      "You read each Project's base branch where it is checked out:\n\n- Site: its trunk branch",
    );
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

    const { text } = freshChatThreadBrief({
      title: "Deploys",
      log,
      projects: PROJECTS,
      memory: NO_MEMORY,
    });

    expect(text).toContain("## The Thread\n\nDeploys");
    expect(text).toContain("## Your Handover note\n\nDeploys explained; next: tests.");
    expect(text).not.toContain("Old note.");
    expect(text).toContain(
      "## The latest exchanges\n\nThe user Ann Lee: Read the deploy workflow.\n\nYou: It deploys on every push to main.\n\nThe user Ann Lee: And the tests?",
    );
    expect(text).not.toContain("deploy.yml");
    expect(text).toContain("## The Projects");
  });

  it("keeps the newest exchanges that fit under about 3k tokens", () => {
    const long = "x".repeat(CHAT_EXCHANGES_TOKENS * 2);
    const log = [say(`first ${long}`), answer(`second ${long}`), say("third")];

    const { text, tokens } = freshChatThreadBrief({
      title: undefined,
      log,
      projects: [],
      memory: NO_MEMORY,
    });

    expect(text).toContain("The user Ann Lee: third");
    expect(text).toContain("You: second");
    expect(text).not.toContain("first");
    expect(text).not.toContain("## The Thread");
    expect(tokens).toBeLessThan(CHAT_EXCHANGES_TOKENS + 200);
  });

  it("keeps the end of a newest message that alone is over the cap", () => {
    const log = [say(`${"x".repeat(CHAT_EXCHANGES_TOKENS * 5)} the end`)];

    const { text } = freshChatThreadBrief({ title: "Long", log, projects: [], memory: NO_MEMORY });

    expect(text).toContain("## The latest exchanges\n\n…");
    expect(text).toMatch(/x the end/);
  });
});

describe("a Brief for a Thread on a Task", () => {
  const answeredAt = new Date("2026-10-25T09:10:00.000Z");

  it("is the Task's record alone when no Decision was opened", () => {
    expect(
      taskThreadBrief({
        record: "## The Task",
        continuing: false,
        answered: [],
        open: undefined,
        memory: NO_MEMORY,
      }).text,
    ).toBe("## The Task");
  });

  it("adds the answered Decisions and the one the Thread waits on, when it continues fresh", () => {
    const { text } = taskThreadBrief({
      record: "## The Task",
      continuing: true,
      answered: [
        aDecision({ answer: { ...oneOptionAnswer(1), answeredAt } }),
        aDecision({
          questions: THREE_QUESTIONS.slice(1),
          answer: {
            kind: "submitted",
            answers: [
              { kind: "words", text: "This year" },
              { kind: "words", text: "CSV, like the old one." },
            ],
            generalComment: "Thanks.",
            answeredAt,
          },
        }),
      ],
      open: aDecision({
        questions: [
          {
            kind: "choice",
            question: "Which columns?",
            options: ["All", "The visible ones"],
            recommendation: { option: 1, reason: "They are what people read." },
          },
          { kind: "open", question: "Any column to rename?" },
        ],
      }),
      memory: NO_MEMORY,
    });

    expect(text).toMatch(/^You are continuing a Thread on a Task in a fresh session/);
    expect(text).toContain(
      [
        "## The Task",
        "## Decisions the user answered",
        "- Should the export include archived Projects?",
      ].join(String.fromCharCode(10, 10)),
    );
    expect(text).toContain(
      "- Should the export include archived Projects?\n  Answer: Every Project\n- Which years",
    );
    expect(text).toContain(
      [
        "- Which years should it cover? (and 1 more question)",
        "  1. Which years should it cover?",
        "     Answer, in their own words: This year",
        "  2. Which format?",
        "     Answer, in their own words: CSV, like the old one.",
        "",
        "  General comment: Thanks.",
      ].join("\n"),
    );
    expect(text).toContain(
      [
        "## Your open Decision",
        "",
        "You asked the user:",
        "",
        "1. Which columns?",
        "   - All",
        "   - The visible ones",
        "",
        "2. Any column to rename?",
        "   An open question, answered in their own words.",
      ].join("\n"),
    );
    expect(text).toMatch(/They haven't answered it yet/);
  });
});

const note = (text: string, day: number, projectId?: string): BriefMemoryNote => ({
  text,
  projectId,
  writtenAt: new Date(Date.UTC(2026, 9, day)),
});

const section = (leftOut: number): string =>
  newChatThreadBrief([], { lines: ["- 2026-10-10: A note."], leftOut }).text;

describe("a person's Memory in a Brief", () => {
  it("takes the notes for all Projects and those of the Task's, oldest first", () => {
    const memory = selectMemory(
      [
        note("Newest, for all.", 20),
        note("Of the Admin panel.", 15, "admin-panel"),
        note("Of another Project.", 12, "billing"),
        note("Oldest, for all.", 10),
      ],
      { kind: "project", projectId: "admin-panel" },
    );

    expect(memory).toEqual({
      lines: [
        "- 2026-10-10: Oldest, for all.",
        "- 2026-10-15: Of the Admin panel.",
        "- 2026-10-20: Newest, for all.",
      ],
      leftOut: 0,
    });
  });

  it("takes only the notes for all Projects on an Initiative", () => {
    const memory = selectMemory([note("For all.", 10), note("Of one.", 11, "admin-panel")], {
      kind: "all-projects",
    });

    expect(memory.lines).toEqual(["- 2026-10-10: For all."]);
  });

  it("takes every note in a chat, which reads every Project, each labelled with what it is about", () => {
    const memory = selectMemory(
      [
        note("For all.", 10),
        note("Of the Admin panel.", 11, "admin-panel"),
        note("Of a Project since removed.", 12, "billing"),
      ],
      { kind: "every-note", projects: PROJECTS },
    );

    expect(memory.lines).toEqual([
      "- 2026-10-10 (All Projects): For all.",
      "- 2026-10-11 (Admin panel): Of the Admin panel.",
      "- 2026-10-12 (billing): Of a Project since removed.",
    ]);
  });

  it("keeps the newest notes that fit under the cap and counts the older ones left out", () => {
    const text = "x".repeat(500);
    const fitting = Math.floor((MEMORY_TOKENS * 4) / `- 2026-10-01: ${text}`.length);
    const notes = Array.from({ length: fitting + 3 }, (_, index) => note(text, index + 1));

    const memory = selectMemory(notes, { kind: "all-projects" });

    expect(memory.lines).toHaveLength(fitting);
    expect(memory.leftOut).toBe(3);
    expect(memory.lines.at(-1)).toContain(`2026-10-${fitting + 3}`);
  });

  it("says in the Brief how many older notes were left out", () => {
    expect(section(2)).toContain(
      "## Your Memory\n\nNotes you wrote in earlier sessions, oldest first:\n\n- 2026-10-10: A note.\n\n2 older notes left out.",
    );
    expect(section(1)).toContain("1 older note left out.");
    expect(section(0)).not.toContain("left out");
    expect(newChatThreadBrief([], NO_MEMORY).text).not.toContain("Your Memory");
  });
});
