import { describe, expect, it } from "vitest";
import { CHAT_STORAGE_KEY, createChatStore, type ChatStore } from "./chat-store.ts";

function aStorage(stored?: string): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map(stored === undefined ? [] : [[CHAT_STORAGE_KEY, stored]]);
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("the chat's place", () => {
  it("starts closed, on nobody", () => {
    expect(createChatStore(aStorage()).place()).toMatchObject({
      isOpen: false,
      roleKey: undefined,
    });
  });

  it("opens on a person's Thread, and a reload finds it there", () => {
    const storage = aStorage();
    createChatStore(storage).open("planner", "a-thread");

    expect(createChatStore(storage).place()).toEqual({
      isOpen: true,
      roleKey: "planner",
      threadId: "a-thread",
      onThreadList: false,
      tabs: [{ roleKey: "planner", threadId: "a-thread", onThreadList: false }],
    });
  });

  it("opens where the user left off when no person is named", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");
    chat.close();

    chat.open();

    expect(chat.place()).toMatchObject({ isOpen: true, roleKey: "planner", threadId: "a-thread" });
  });

  it("opens a newly opened person on their newest Thread", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");

    chat.open("devops");

    expect(chat.place()).toMatchObject({ roleKey: "devops", threadId: undefined });
  });

  it("steps back to the Thread list, and on to a Thread", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");

    chat.showThreadList();
    expect(chat.place()).toMatchObject({ onThreadList: true, threadId: "a-thread" });

    chat.showThread("another");
    expect(chat.place()).toMatchObject({ onThreadList: false, threadId: "another" });
  });

  it("keeps a place stored before the tabs as its person's tab", () => {
    const stored = { isOpen: true, roleKey: "planner", threadId: "a-thread", onThreadList: true };

    expect(createChatStore(aStorage(JSON.stringify(stored))).place()).toEqual({
      ...stored,
      tabs: [{ roleKey: "planner", threadId: "a-thread", onThreadList: true }],
    });
  });

  it("leaves a stored place it can't read, closed", () => {
    expect(createChatStore(aStorage("not json")).place().isOpen).toBe(false);
    expect(createChatStore(aStorage('{"isOpen":"yes"}')).place().isOpen).toBe(false);
  });

  it("still moves where storage is blocked", () => {
    const chat = createChatStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
    });

    chat.open("planner");

    expect(chat.place().isOpen).toBe(true);
  });
});

const roleKeys = (chat: ChatStore): string[] => chat.place().tabs.map(({ roleKey }) => roleKey);

function withTabs(...people: string[]): ChatStore {
  const chat = createChatStore(aStorage());
  for (const roleKey of people) chat.open(roleKey);
  return chat;
}

describe("the chat's tabs", () => {
  it("adds a tab for each person opened, once, in the order they were opened", () => {
    const chat = withTabs("planner", "devops", "planner");

    expect(roleKeys(chat)).toEqual(["planner", "devops"]);
    expect(chat.place().roleKey).toBe("planner");
  });

  it("brings each person back where the user left them", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");
    chat.open("devops", "another-thread");
    chat.showThreadList();

    chat.open("planner");
    expect(chat.place()).toMatchObject({ threadId: "a-thread", onThreadList: false });

    chat.open("devops");
    expect(chat.place()).toMatchObject({ threadId: "another-thread", onThreadList: true });
  });

  it("moves a person's tab to the Thread named", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");
    chat.showThreadList();

    chat.open("planner", "another-thread");

    expect(chat.place()).toMatchObject({ threadId: "another-thread", onThreadList: false });
  });

  it("shows the tab on the right of the shown one closed, or on its left at the end", () => {
    const chat = withTabs("planner", "devops", "cto");
    chat.open("devops");

    chat.closeTab("devops");
    expect(chat.place().roleKey).toBe("cto");

    chat.closeTab("cto");
    expect(chat.place().roleKey).toBe("planner");
    expect(roleKeys(chat)).toEqual(["planner"]);
  });

  it("leaves the shown chat as it was when another tab closes", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner");
    chat.open("devops", "a-thread");

    chat.closeTab("planner");

    expect(chat.place()).toMatchObject({ isOpen: true, roleKey: "devops", threadId: "a-thread" });
    expect(roleKeys(chat)).toEqual(["devops"]);
  });

  it("leaves the person picker once the last tab closes, with the drawer open", () => {
    const chat = withTabs("planner");

    chat.closeTab("planner");

    expect(chat.place()).toMatchObject({ isOpen: true, roleKey: undefined, tabs: [] });
  });

  it("opens a closed person's tab again, at the end, on their newest Thread", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");
    chat.open("devops");
    chat.closeTab("planner");

    chat.open("planner");

    expect(roleKeys(chat)).toEqual(["devops", "planner"]);
    expect(chat.place()).toMatchObject({ roleKey: "planner", threadId: undefined });
  });

  it("keeps the tabs through closing the drawer and a reload", () => {
    const storage = aStorage();
    const chat = createChatStore(storage);
    chat.open("planner");
    chat.open("devops");
    chat.close();

    const reloaded = createChatStore(storage);
    reloaded.open();

    expect(roleKeys(reloaded)).toEqual(["planner", "devops"]);
    expect(reloaded.place().roleKey).toBe("devops");
  });
});

describe("the left-out Open page", () => {
  const aTask = { kind: "task", taskId: "a-task" } as const;
  const anotherTask = { kind: "task", taskId: "another-task" } as const;

  it("stays left out while that page stays open, whatever the drawer does", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");
    chat.leaveOut(aTask);

    chat.openPageChanged({ ...aTask });
    chat.showThread("another-thread");
    chat.open("devops");
    chat.close();
    chat.open();

    expect(chat.leftOutPage()).toEqual(aTask);
  });

  it("comes back once another page opens, and stays back on returning", () => {
    const chat = createChatStore(aStorage());
    chat.leaveOut(aTask);

    chat.openPageChanged(anotherTask);
    expect(chat.leftOutPage()).toBeUndefined();

    chat.openPageChanged(aTask);
    expect(chat.leftOutPage()).toBeUndefined();
  });

  it("comes back once a page with no Open page opens", () => {
    const chat = createChatStore(aStorage());
    chat.leaveOut(aTask);

    chat.openPageChanged(undefined);

    expect(chat.leftOutPage()).toBeUndefined();
  });

  it("tells the drawer when it changes", () => {
    const chat = createChatStore(aStorage());
    let changes = 0;
    chat.subscribe(() => (changes += 1));

    chat.leaveOut(aTask);
    chat.openPageChanged(aTask);
    chat.openPageChanged(anotherTask);
    chat.openPageChanged(aTask);

    expect(changes).toBe(2);
  });
});
