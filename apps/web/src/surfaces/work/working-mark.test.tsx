import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { WorkingMark } from "./working-mark.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function rendered(mark: ReactNode): HTMLElement {
  const host = document.createElement("div");
  act(() => createRoot(host).render(mark));
  return host;
}

describe("WorkingMark", () => {
  it("names the people working, with an avatar each and the live dot", () => {
    const mark = rendered(<WorkingMark names={["Michael Scott", "Angela"]} />);

    const shown = mark.querySelector("[role=img]");
    expect(shown?.getAttribute("aria-label")).toBe("Working now: Michael Scott, Angela");
    expect(mark.querySelector(".live-dot")).not.toBeNull();
    expect(mark.querySelector(".working-mark-avatars")?.childElementCount).toBe(2);
    expect(mark.querySelector(".working-mark-others")).toBeNull();
  });

  it('shows 3 avatars and "+N" for the rest, and still names everyone', () => {
    const names = ["Michael", "Angela", "Jim", "Pam", "Dwight"];

    const mark = rendered(<WorkingMark names={names} />);

    expect(mark.querySelector(".working-mark-avatars")?.childElementCount).toBe(3);
    expect(mark.querySelector(".working-mark-others")?.textContent).toBe("+2");
    expect(mark.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Working now: Michael, Angela, Jim, Pam, Dwight",
    );
  });
});
