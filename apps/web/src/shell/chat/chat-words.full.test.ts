import type { Role } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  chatButtonLook,
  chatButtonWords,
  chatStanding,
  withoutThreadShown,
  type PersonActivity,
} from "./chat-words.ts";

const EARLIER = "2026-11-06T09:00:00.000Z";
const LATER = "2026-11-06T10:00:00.000Z";

function aRole(key: string, name: string): Role {
  return { key, card: { name } } as Role;
}

function activity(fields: Partial<PersonActivity> = {}): PersonActivity {
  return { roleKey: "any", answering: false, answered: [], lastMovedAt: EARLIER, ...fields };
}

const pam = aRole("office-manager", "Pam");
const angela = aRole("planner", "Angela");
const jan = aRole("caretaker", "Jan");

describe("chatStanding", () => {
  it("says answered over answering, as that waits on the user", () => {
    const standing = chatStanding(
      activity({ answering: true, answered: [{ threadId: "a", at: LATER }] }),
    );

    expect(standing.kind).toBe("answered");
    expect(standing.words).toMatch(/^Answered · /);
  });

  it("says answering, when the chat last moved, or that there are no Threads", () => {
    expect(chatStanding(activity({ answering: true }))).toEqual({
      kind: "answering",
      words: "Answering…",
    });
    expect(chatStanding(activity()).kind).toBe("quiet");
    expect(chatStanding(undefined)).toEqual({ kind: "none", words: "No Threads yet" });
  });
});

describe("chatButtonLook", () => {
  it("is nothing new with nothing going on", () => {
    expect(chatButtonLook([{ role: pam, activity: undefined }])).toEqual({ kind: "nothing-new" });
  });

  it("shows who is answering", () => {
    const look = chatButtonLook([
      { role: pam, activity: activity() },
      { role: angela, activity: activity({ answering: true }) },
    ]);

    expect(look).toEqual({ kind: "answering", person: angela });
    expect(chatButtonWords(look)).toBe("Chat: Angela is answering");
  });

  it("shows two who answered at most, the latest first, and leads to the newest answer", () => {
    const look = chatButtonLook([
      { role: pam, activity: activity({ answered: [{ threadId: "older", at: EARLIER }] }) },
      { role: angela, activity: activity({ answered: [{ threadId: "newest", at: LATER }] }) },
      { role: jan, activity: activity({ answered: [{ threadId: "oldest", at: EARLIER }] }) },
    ]);

    expect(look).toEqual({
      kind: "answered",
      people: [angela, pam],
      roleKey: "planner",
      threadId: "newest",
    });
    expect(chatButtonWords(look)).toBe("Chat: Angela and Pam answered");
  });

  it("lets answered win over answering", () => {
    const look = chatButtonLook([
      { role: pam, activity: activity({ answering: true }) },
      { role: angela, activity: activity({ answered: [{ threadId: "a", at: LATER }] }) },
    ]);

    expect(look.kind).toBe("answered");
  });
});

describe("withoutThreadShown", () => {
  it("leaves the Thread on screen out, and another Thread's answer in", () => {
    const person = activity({
      answered: [
        { threadId: "shown", at: LATER },
        { threadId: "other", at: EARLIER },
      ],
    });

    expect(withoutThreadShown(person, "shown")?.answered).toEqual([
      { threadId: "other", at: EARLIER },
    ]);
  });
});
