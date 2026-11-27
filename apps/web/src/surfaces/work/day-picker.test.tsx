import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonNamed } from "../../shell/page.fixtures.tsx";
import { DayPicker } from "./day-picker.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

function show(
  day: string | undefined,
  today: string | undefined,
): { page: HTMLElement; picked: string[] } {
  const picked: string[] = [];
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(<DayPicker day={day} today={today} onPick={(chosen) => picked.push(chosen)} />);
  });
  return { page, picked };
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("the day picker", () => {
  it("takes today from the service's answer, never from the browser's clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-05-05T12:00:00Z"));
    const { page, picked } = show("2026-11-20", "2026-11-27");
    act(() => buttonNamed(page, "Today")?.click());
    act(() => buttonNamed(page, "Yesterday")?.click());
    expect(picked).toEqual(["2026-11-27", "2026-11-26"]);
  });

  it("steps a day back and forward, and ends at the service's today", () => {
    const past = show("2026-11-20", "2026-11-27");
    act(() => buttonNamed(past.page, "Previous day")?.click());
    act(() => buttonNamed(past.page, "Next day")?.click());
    expect(past.picked).toEqual(["2026-11-19", "2026-11-21"]);
    act(() => root?.unmount());
    document.body.replaceChildren();
    const now = show("2026-11-27", "2026-11-27");
    expect(buttonNamed(now.page, "Next day")?.disabled).toBe(true);
    expect(buttonNamed(now.page, "Previous day")?.disabled).toBe(false);
    expect(now.page.querySelector("input")?.max).toBe("2026-11-27");
  });

  it("holds the choices that need today until the first answer", () => {
    const { page } = show("2026-11-20", undefined);
    expect(buttonNamed(page, "Today")?.disabled).toBe(true);
    expect(buttonNamed(page, "Yesterday")?.disabled).toBe(true);
    expect(buttonNamed(page, "Next day")?.disabled).toBe(true);
    expect(buttonNamed(page, "Previous day")?.disabled).toBe(false);
  });
});
