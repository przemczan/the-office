import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { WorkingMark, type PersonWorking } from "./working-mark.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function rendered(mark: ReactNode): HTMLElement {
  const host = document.createElement("div");
  act(() =>
    createRoot(host).render(
      <QueryClientProvider client={new QueryClient()}>{mark}</QueryClientProvider>,
    ),
  );
  return host;
}

function working(...names: readonly string[]): readonly PersonWorking[] {
  return names.map((name) => ({ roleKey: name.toLowerCase(), name }));
}

describe("WorkingMark", () => {
  it("names the people working, with an avatar each and the live dot", () => {
    const mark = rendered(<WorkingMark people={working("Michael Scott", "Angela")} />);

    const shown = mark.querySelector("[role=img]");
    expect(shown?.getAttribute("aria-label")).toBe("Working now: Michael Scott, Angela");
    expect(mark.querySelector(".live-dot")).not.toBeNull();
    expect(mark.querySelector(".working-mark-avatars")?.childElementCount).toBe(2);
    expect(mark.querySelector(".working-mark-others")).toBeNull();
  });

  it('shows 3 avatars and "+N" for the rest, and still names everyone', () => {
    const people = working("Michael", "Angela", "Jim", "Pam", "Dwight");

    const mark = rendered(<WorkingMark people={people} />);

    expect(mark.querySelector(".working-mark-avatars")?.childElementCount).toBe(3);
    expect(mark.querySelector(".working-mark-others")?.textContent).toBe("+2");
    expect(mark.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Working now: Michael, Angela, Jim, Pam, Dwight",
    );
  });

  it("says the Stage's name with the names, and shows it just before the avatars", () => {
    const mark = rendered(<WorkingMark people={working("Jim Halpert")} stageName="Implement" />);

    const shown = mark.querySelector("[role=img]");
    expect(shown?.getAttribute("aria-label")).toBe("Working now: Jim Halpert · Implement");
    const label = shown?.querySelector(".working-mark-stage");
    expect(label?.textContent).toBe("Implement");
    // Before the live dot and the avatars, which keep the mark's right end.
    expect(shown?.firstElementChild).toBe(label);
    expect(label?.nextElementSibling?.classList.contains("live-dot")).toBe(true);
  });

  it("says the names alone without a Stage name, and shows no label", () => {
    const mark = rendered(<WorkingMark people={working("Jim Halpert")} />);

    expect(mark.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Working now: Jim Halpert",
    );
    expect(mark.querySelector(".working-mark-stage")).toBeNull();
    expect(mark.querySelector(".working-mark-with-stage")).toBeNull();
  });

  it("shows the current Stage alone while nobody works, with no live dot or avatars", () => {
    const mark = rendered(<WorkingMark people={[]} stageName="Tests" />);

    const shown = mark.querySelector("[role=img]");
    expect(shown?.getAttribute("aria-label")).toBe("Current Stage: Tests");
    expect(shown?.querySelector(".working-mark-stage")?.textContent).toBe("Tests");
    expect(mark.querySelector(".live-dot")).toBeNull();
    expect(mark.querySelector(".working-mark-avatars")).toBeNull();
  });
});
