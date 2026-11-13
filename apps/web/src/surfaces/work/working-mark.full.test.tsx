import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CurrentStage } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { stageWorkedNow, WorkingMark, type PersonWorking } from "./working-mark.tsx";

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

function stage(name: string, role: string | null): CurrentStage {
  return { key: name.toLowerCase(), name, role, since: "2026-11-09T09:00:00.000Z" };
}

describe("stageWorkedNow", () => {
  it("names the current Stage while one of the people working works it", () => {
    expect(stageWorkedNow(working("Angela", "Jim"), stage("Implement", "jim"))).toBe("Implement");
  });

  it("names none at a Script Stage or a Gate, which no Role works", () => {
    expect(stageWorkedNow(working("Jim"), stage("Tests", null))).toBeUndefined();
  });

  it("names none while the people working aren't the one working the Stage", () => {
    expect(stageWorkedNow(working("Angela"), stage("Implement", "jim"))).toBeUndefined();
  });

  it("names none before the first Stage run, as in Planning, or with nobody working", () => {
    expect(stageWorkedNow(working("Jim"), undefined)).toBeUndefined();
    expect(stageWorkedNow([], stage("Implement", "jim"))).toBeUndefined();
  });
});

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

  it("says the Stage's name with the names, and shows only the avatars", () => {
    const mark = rendered(<WorkingMark people={working("Jim Halpert")} stageName="Implement" />);

    expect(mark.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Working now: Jim Halpert · Implement",
    );
    expect(mark.textContent).not.toContain("Implement");
  });

  it("says the names alone without a Stage name", () => {
    const mark = rendered(<WorkingMark people={working("Jim Halpert")} />);

    expect(mark.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Working now: Jim Halpert",
    );
  });
});
