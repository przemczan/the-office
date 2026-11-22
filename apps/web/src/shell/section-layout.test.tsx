import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SectionLayout, type MenuSection } from "./section-layout.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function rendered(address: string, layout: () => ReactNode): Promise<HTMLElement> {
  const root = createRootRoute({ component: layout });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "projects" }),
      createRoute({ getParentRoute: () => root, path: "projects/$projectId" }),
      createRoute({ getParentRoute: () => root, path: "projects/$projectId/files" }),
    ]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(<RouterProvider router={router} />);
    await router.load();
  });
  return page;
}

function thing(id: string): MenuSection {
  return {
    key: id,
    to: "/projects/$projectId",
    params: { projectId: id },
    leading: <img className="thing-logo" alt="" />,
    label: `Thing ${id}`,
    trailing: <span className="thing-badge">new</span>,
  };
}

function layoutOf(page: HTMLElement): HTMLElement {
  const layout = page.querySelector<HTMLElement>(".section-layout");
  if (layout === null) throw new Error("No SectionLayout rendered");
  return layout;
}

describe("SectionLayout", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("by default draws icon items in a menu that folds into a row, with no foot or back link", async () => {
    const page = await rendered("/projects", () => (
      <SectionLayout label="Things" sections={[{ to: "/projects", icon: "box", label: "All" }]}>
        open
      </SectionLayout>
    ));
    expect(layoutOf(page).className).toBe("section-layout");
    expect(page.querySelector('nav[aria-label="Things"] a svg')).not.toBeNull();
    expect(page.querySelector(".section-foot")).toBeNull();
    expect(page.querySelector(".section-back")).toBeNull();
    expect(page.querySelector(".section-body")?.textContent).toBe("open");
  });

  it("links each item to its own params, marking the open one on its sub-addresses too", async () => {
    const page = await rendered("/projects/b/files", () => (
      <SectionLayout label="Things" sections={[thing("a"), thing("b")]}>
        open
      </SectionLayout>
    ));
    const links = [...page.querySelectorAll<HTMLAnchorElement>(".section-menu a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/projects/a", "/projects/b"]);
    expect(links.map((link) => link.classList.contains("active"))).toEqual([false, true]);
  });

  it("draws the leading element in place of an icon, and the trailing one after the label", async () => {
    const page = await rendered("/projects", () => (
      <SectionLayout label="Things" sections={[thing("a")]}>
        open
      </SectionLayout>
    ));
    const link = page.querySelector(".section-menu a");
    expect(link?.querySelector("svg")).toBeNull();
    expect([...(link?.children ?? [])].map((child) => child.className)).toEqual([
      "thing-logo",
      "section-menu-words",
      "thing-badge",
    ]);
    expect(link?.querySelector(".section-menu-description")).toBeNull();
    expect(link?.querySelector(".section-menu-label")?.getAttribute("title")).toBeNull();
  });

  it("with size large, draws the description under the label and names the item whole on hover", async () => {
    const page = await rendered("/projects", () => (
      <SectionLayout
        label="Things"
        sections={[{ ...thing("a"), description: "acme/thing · main" }]}
        size="large"
      >
        open
      </SectionLayout>
    ));
    const words = page.querySelector(".section-menu a .section-menu-words");
    expect([...(words?.children ?? [])].map((child) => child.textContent)).toEqual([
      "Thing a",
      "acme/thing · main",
    ]);
    const label = words?.querySelector(".section-menu-label");
    expect(label?.getAttribute("title")).toBe("Thing a");
    // Named by its label alone, described by the line under it.
    const link = page.querySelector(".section-menu a");
    expect(label?.id).toMatch(/-label$/);
    expect(link?.getAttribute("aria-labelledby")).toBe(label?.id);
    expect(link?.getAttribute("aria-describedby")).toBe(
      words?.querySelector(".section-menu-description")?.id,
    );
  });

  it("with size large, a foot and list-or-open, marks the layout and draws the foot and back link", async () => {
    const page = await rendered("/projects/a", () => (
      <SectionLayout
        label="Things"
        sections={[thing("a")]}
        size="large"
        narrow="list-or-open"
        showingOpen
        back={{ label: "All Things", to: "/projects" }}
        foot={<button type="button">Add a Thing</button>}
      >
        open
      </SectionLayout>
    ));
    expect(layoutOf(page).classList.value).toBe(
      "section-layout size-large narrow-list-or-open showing-open",
    );
    expect(page.querySelector(".section-side > .section-foot")?.textContent).toBe("Add a Thing");
    const back = page.querySelector<HTMLAnchorElement>(".section-body > .section-back");
    expect(back?.textContent).toBe("‹ All Things");
    expect(back?.getAttribute("href")).toBe("/projects");
  });

  it("with list-or-open and nothing open, leaves the menu to show alone on a narrow page", async () => {
    const page = await rendered("/projects", () => (
      <SectionLayout label="Things" sections={[thing("a")]} narrow="list-or-open">
        empty
      </SectionLayout>
    ));
    expect(layoutOf(page).classList.contains("showing-open")).toBe(false);
  });
});
