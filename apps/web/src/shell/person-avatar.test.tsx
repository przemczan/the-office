import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { roleQueries } from "../api/people.ts";
import { PersonAvatar } from "./person-avatar.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function aRole(key: string, avatarId: string | null): Role {
  const avatar = avatarId && { id: avatarId, mediaType: "image/png" };
  return { key, avatar } as Role;
}

function rendered(roles: Role[], person: ReactNode): HTMLElement {
  const queryClient = new QueryClient();
  queryClient.setQueryData(roleQueries.list().queryKey, roles);
  const host = document.createElement("div");
  act(() =>
    createRoot(host).render(
      <QueryClientProvider client={queryClient}>{person}</QueryClientProvider>,
    ),
  );
  return host;
}

describe("PersonAvatar", () => {
  it("shows the person's Avatar in place of their initials", () => {
    const host = rendered(
      [aRole("developer", "an-image")],
      <PersonAvatar roleKey="developer" name="Ada Lovelace" size="md" />,
    );

    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "/api/roles/developer/avatar/an-image/content",
    );
    expect(host.textContent).toBe("");
  });

  it("shows the initials without an Avatar", () => {
    const host = rendered(
      [aRole("developer", null)],
      <PersonAvatar roleKey="developer" name="Ada Lovelace" size="md" />,
    );

    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe("AL");
  });

  it("falls back to the initials when the image can't be loaded", () => {
    const host = rendered(
      [aRole("developer", "an-image")],
      <PersonAvatar roleKey="developer" name="Ada Lovelace" size="md" />,
    );

    act(() => void host.querySelector("img")?.dispatchEvent(new Event("error")));

    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe("AL");
  });

  it("shows each person their own, under the same name", () => {
    const host = rendered(
      [aRole("developer", "first"), aRole("reviewer", "second"), aRole("planner", null)],
      <>
        <PersonAvatar roleKey="developer" name="Ada" size="md" />
        <PersonAvatar roleKey="reviewer" name="Ada" size="md" />
        <PersonAvatar roleKey="planner" name="Ada" size="md" />
      </>,
    );

    expect([...host.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
      "/api/roles/developer/avatar/first/content",
      "/api/roles/reviewer/avatar/second/content",
    ]);
    expect(host.textContent).toBe("A");
  });
});
