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
import { usePageScrollReset } from "./use-page-scroll-reset.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Frame(): ReactNode {
  const page = usePageScrollReset();
  return <main ref={page} className="shell-main" />;
}

function pagesRouter() {
  const root = createRootRoute({ component: Frame });
  return createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "now" }),
      createRoute({ getParentRoute: () => root, path: "work" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/now"] }),
  });
}

async function rendered(): Promise<ReturnType<typeof pagesRouter>> {
  const router = pagesRouter();
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(<RouterProvider router={router} />);
    await router.load();
  });
  return router;
}

describe("usePageScrollReset", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("scrolls the page to its top when the path changes, not when only the search does", async () => {
    const router = await rendered();
    const main = document.querySelector<HTMLElement>(".shell-main");
    if (main === null) throw new Error("No page rendered");
    main.scrollTop = 300;

    await act(async () => {
      await router.navigate({ to: "/now", search: { chat: "devops" } as never });
    });
    expect(main.scrollTop).toBe(300);

    await act(async () => {
      await router.navigate({ to: "/work" });
    });
    expect(main.scrollTop).toBe(0);
  });
});
