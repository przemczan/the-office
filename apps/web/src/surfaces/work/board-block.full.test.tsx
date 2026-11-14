import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { QueuedTask, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InitiativeBlock, type InitiativeBlockProps } from "./board-block.tsx";
import { COLUMNS, type Column } from "./board-columns.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the tooltip never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const INITIATIVE = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Offline sync for the field app",
  pausedAt: null,
};

const card = (id: string): Task => ({ id, state: "ready" }) as Task;

function column(key: string): Column {
  const found = COLUMNS.find((each) => each.key === key);
  if (!found) throw new Error(`No column ${key}`);
  return found;
}

function queued(taskId: string, place: number): QueuedTask {
  return {
    taskId,
    place,
    queuedAt: "2026-11-14T09:00:00.000Z",
    reasons: [],
    shortReasons: [],
    behind: [],
  };
}

const roots: Root[] = [];

async function rendered(props: Partial<InitiativeBlockProps> = {}): Promise<HTMLElement> {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <InitiativeBlock
          initiative={INITIATIVE}
          column={column("ready")}
          cards={[card("a"), card("b")]}
          queue={[]}
          outlined={false}
          landing={false}
          onOutline={() => {}}
          {...props}
        >
          <article>The cards</article>
        </InitiativeBlock>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  await act(async () => root.render(<RouterProvider router={router} />));
  return page;
}

const block = (page: HTMLElement): HTMLElement | null => page.querySelector('[role="group"]');
const count = (page: HTMLElement): HTMLElement | null =>
  page.querySelector(".initiative-block-count");

describe("InitiativeBlock", () => {
  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()));
    document.body.replaceChildren();
  });

  it("is a group named by its Initiative, never a region or a heading, holding its cards", async () => {
    const page = await rendered();

    expect(block(page)?.getAttribute("aria-label")).toBe(INITIATIVE.name);
    expect(
      page.querySelector('section, [role="region"], h1, h2, h3, h4, [role="heading"]'),
    ).toBeNull();
    expect(block(page)?.querySelector("article")?.textContent).toBe("The cards");
  });

  it("heads it with the flag and its name, a link to the Initiative", async () => {
    const page = await rendered();

    const link = page.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/work/initiatives/${INITIATIVE.id}`);
    expect(link?.textContent).toBe(INITIATIVE.name);
    expect(link?.querySelector("svg")).not.toBeNull();
  });

  it("shows Paused while its Initiative is paused", async () => {
    expect((await rendered()).textContent).not.toContain("Paused");

    const paused = await rendered({
      initiative: { ...INITIATIVE, pausedAt: "2026-11-12T12:00:00.000Z" },
    });

    expect(paused.querySelector(".initiative-block-head")?.textContent).toContain("Paused");
  });

  it("counts the column's cards, with its words in a tooltip", async () => {
    const page = await rendered();

    expect(count(page)?.textContent).toBe("2");
    expect(count(page)?.getAttribute("aria-label")).toBe("2 of its Tasks in Ready");
    act(() => {
      count(page)?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("2 of its Tasks in Ready");
  });

  it("names its cards' places in Queued", async () => {
    const page = await rendered({
      column: column("queued"),
      queue: [queued("a", 1), queued("b", 3)],
    });

    expect(count(page)?.textContent).toBe("#1 · #3");
    expect(count(page)?.getAttribute("aria-label")).toBe("Places 1 and 3 in the queue");
  });

  it("asks to outline its Initiative while its head is hovered or focused", async () => {
    const onOutline = vi.fn<(initiativeId: string | undefined) => void>();
    const page = await rendered({ onOutline });
    const head = page.querySelector(".initiative-block-head");

    act(() => {
      head?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(onOutline).toHaveBeenLastCalledWith(INITIATIVE.id);
    act(() => {
      head?.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(onOutline).toHaveBeenLastCalledWith(undefined);
    act(() => page.querySelector("a")?.focus());
    expect(onOutline).toHaveBeenLastCalledWith(INITIATIVE.id);
  });

  it("shows itself outlined, and where a dragged card lands", async () => {
    const page = await rendered({ outlined: true, landing: true });

    expect(block(page)?.className).toBe("initiative-block outlined drop-ok");
  });
});
