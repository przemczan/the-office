import { describe, expect, it } from "vitest";
import { CHAT_STORAGE_KEY, createChatStore } from "./chat-store.ts";

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
    });
  });

  it("opens where the user left off when no person is named", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");
    chat.close();

    chat.open();

    expect(chat.place()).toMatchObject({ isOpen: true, roleKey: "planner", threadId: "a-thread" });
  });

  it("moves to the newest Thread when a person is named alone", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");

    chat.open("planner");

    expect(chat.place().threadId).toBeUndefined();
  });

  it("steps back to the Thread list, and on to a Thread", () => {
    const chat = createChatStore(aStorage());
    chat.open("planner", "a-thread");

    chat.showThreadList();
    expect(chat.place()).toMatchObject({ onThreadList: true, threadId: "a-thread" });

    chat.showThread("another");
    expect(chat.place()).toMatchObject({ onThreadList: false, threadId: "another" });
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
