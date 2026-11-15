import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { roleQueries } from "../../api/people.ts";
import type { ChatTab } from "./chat-store.ts";
import { ChatTabs } from "./chat-tabs.tsx";
import type { ChatPerson, PersonActivity } from "./chat-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const A_MOMENT = "2026-11-15T09:00:00.000Z";

function aPerson(key: string, name: string, activity?: Partial<PersonActivity>): ChatPerson {
  const role = { key, avatar: null, card: { name, title: "A title" } } as unknown as Role;
  return {
    role,
    activity: activity && {
      roleKey: key,
      answering: false,
      answered: [],
      lastMovedAt: A_MOMENT,
      ...activity,
    },
  };
}

const aTab = (roleKey: string): ChatTab => ({ roleKey, threadId: undefined, onThreadList: false });

const PLANNER = aPerson("planner", "Jan Planner");
const DEVELOPER = aPerson("developer", "Ada Developer", {
  answered: [{ threadId: "a-thread", at: A_MOMENT }],
});
const CTO = aPerson("cto", "Grace CTO", { answering: true });

let mounted: HTMLElement | undefined;
afterEach(() => mounted?.remove());

type OnPerson = (roleKey: string) => void;

interface Rendered {
  readonly host: HTMLElement;
  readonly onShow: Mock<OnPerson>;
  readonly onClose: Mock<OnPerson>;
}

function rendered({
  tabs = [aTab("planner"), aTab("developer"), aTab("cto")],
  shown = "planner",
  people = [PLANNER, DEVELOPER, CTO],
}: {
  readonly tabs?: readonly ChatTab[];
  readonly shown?: string | undefined;
  readonly people?: readonly ChatPerson[];
} = {}): Rendered {
  const onShow = vi.fn<OnPerson>();
  const onClose = vi.fn<OnPerson>();
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    roleQueries.list().queryKey,
    people.map(({ role }) => role),
  );
  const host = document.body.appendChild(document.createElement("div"));
  mounted = host;
  const root = createRoot(host);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChatTabs tabs={tabs} shown={shown} people={people} onShow={onShow} onClose={onClose} />
      </QueryClientProvider>,
    ),
  );
  return { host, onShow, onClose };
}

const tabsIn = (element: HTMLElement): HTMLElement[] => [
  ...element.querySelectorAll<HTMLElement>('[role="tab"]'),
];

function tabAt(element: HTMLElement, index: number): HTMLElement {
  const tab = tabsIn(element)[index];
  if (!tab) throw new Error(`No tab ${index}.`);
  return tab;
}

function press(element: HTMLElement, key: string): void {
  act(() => void element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

describe("the chat's tabs", () => {
  it("shows a tab for each person open, the one shown selected", () => {
    const { host } = rendered();

    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabsIn(host).map((tab) => tab.textContent)).toEqual([
      "JPJan Planner",
      "ADAda Developer",
      "GCGrace CTO",
    ]);
    expect(tabsIn(host).map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(tabsIn(host).map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it("shows the answered and answering dots", () => {
    const { host } = rendered();
    const [planner, developer, cto] = tabsIn(host);

    expect(planner?.querySelector(".chat-dot")).toBeNull();
    expect(developer?.querySelector(".chat-dot.answered")).not.toBeNull();
    expect(cto?.querySelector(".chat-dot.answering")).not.toBeNull();
  });

  it("switches to the person pressed", () => {
    const { host, onShow } = rendered();

    act(() => tabAt(host, 1).click());

    expect(onShow).toHaveBeenCalledWith("developer");
  });

  it("closes a tab with its ×", () => {
    const { host, onClose } = rendered();
    const close = host.querySelector<HTMLButtonElement>(
      '[aria-label="Close the chat with Ada Developer"]',
    );

    act(() => close?.click());

    expect(onClose).toHaveBeenCalledWith("developer");
  });

  it("moves between the tabs with the arrow keys, around the ends", () => {
    const { host, onShow } = rendered();
    const planner = tabAt(host, 0);
    const developer = tabAt(host, 1);
    const cto = tabAt(host, 2);

    press(planner, "ArrowRight");
    expect(document.activeElement).toBe(developer);

    press(developer, "End");
    expect(document.activeElement).toBe(cto);

    press(cto, "ArrowRight");
    expect(document.activeElement).toBe(planner);

    press(planner, "ArrowLeft");
    expect(document.activeElement).toBe(cto);
    expect(onShow).not.toHaveBeenCalled();
  });

  it("closes the focused tab with Delete, the focus moving to its neighbour", () => {
    const { host, onShow, onClose } = rendered();
    tabAt(host, 0).focus();
    press(tabAt(host, 0), "Delete");

    expect(onShow).toHaveBeenCalledWith("developer");
    expect(onClose).toHaveBeenCalledWith("planner");
    expect(document.activeElement).toBe(tabAt(host, 1));
  });

  it("closing the shown tab shows its neighbour on screen, past a person left out", () => {
    const { host, onShow, onClose } = rendered({ shown: "planner", people: [PLANNER, CTO] });
    const close = host.querySelector<HTMLButtonElement>(
      '[aria-label="Close the chat with Jan Planner"]',
    );

    act(() => close?.click());

    expect(onShow).toHaveBeenCalledWith("cto");
    expect(onClose).toHaveBeenCalledWith("planner");
  });

  it("closing another tab keeps the shown one and gives it the focus", () => {
    const { host, onShow, onClose } = rendered();
    const developer = tabAt(host, 1);
    developer.focus();
    press(developer, "Delete");

    expect(onShow).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith("developer");
    expect(document.activeElement).toBe(tabAt(host, 0));
  });

  it("leaves out a person no longer offered in the chat", () => {
    const { host } = rendered({ people: [PLANNER, CTO] });

    expect(tabsIn(host).map((tab) => tab.textContent)).toEqual(["JPJan Planner", "GCGrace CTO"]);
  });

  it("shows nothing with no tab open", () => {
    const { host } = rendered({ tabs: [], shown: undefined });

    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });
});
