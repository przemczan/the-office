import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shownText } from "../../../shell/page.fixtures.tsx";
import type { WindowStartDraft } from "./engine-settings-draft.ts";
import { WindowStartFields } from "./window-start-fields.tsx";

const OFF: WindowStartDraft = { setTimesOn: false, startAtTimes: [], startAfterReset: false };
const SET: WindowStartDraft = {
  setTimesOn: true,
  startAtTimes: ["07:00", "17:00"],
  startAfterReset: false,
};

let root: Root | undefined;

function fields(
  windowStart: WindowStartDraft,
  change: (windowStart: WindowStartDraft) => void = () => undefined,
): HTMLElement {
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(
      <WindowStartFields
        windowStart={windowStart}
        timeZone="Europe/Warsaw"
        nextStartAt={null}
        last={null}
        change={change}
      />,
    );
  });
  return page;
}

function click(page: HTMLElement, selector: string, text: string): void {
  const element = [...page.querySelectorAll<HTMLElement>(selector)].find((each) =>
    each.textContent.includes(text),
  );
  if (!element) throw new Error(`There is no ${text}.`);
  act(() => element.click());
}

describe("An engine's Window start", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
  });

  it("turns set times on with a first time, the next whole hour", () => {
    const change = vi.fn<(windowStart: WindowStartDraft) => void>();
    const page = fields(OFF, change);

    expect(page.querySelector('input[type="time"]')).toBeNull();
    click(page, "label", "Start at set times");

    expect(change).toHaveBeenCalledWith({
      setTimesOn: true,
      startAtTimes: [expect.stringMatching(/^\d\d:00$/)],
      startAfterReset: false,
    });
  });

  it("shows each set time with Remove and the service's time zone, and clears them when turned off", () => {
    const change = vi.fn<(windowStart: WindowStartDraft) => void>();
    const page = fields(SET, change);

    expect(
      [...page.querySelectorAll<HTMLInputElement>('input[type="time"]')].map(({ value }) => value),
    ).toEqual(["07:00", "17:00"]);
    expect(shownText(page)).toContain("Times in Europe/Warsaw");
    click(page, "label", "Start at set times");

    expect(change).toHaveBeenCalledWith({ ...SET, setTimesOn: false, startAtTimes: [] });
  });

  it("adds an empty time and removes one", () => {
    const change = vi.fn<(windowStart: WindowStartDraft) => void>();
    const page = fields(SET, change);

    click(page, "button", "Add a time");
    expect(change).toHaveBeenLastCalledWith({ ...SET, startAtTimes: ["07:00", "17:00", ""] });

    act(() => page.querySelector<HTMLElement>('button[aria-label="Remove 07:00"]')?.click());
    expect(change).toHaveBeenLastCalledWith({ ...SET, startAtTimes: ["17:00"] });
  });

  it("says why a repeated time holds Save, under the repeat", () => {
    const page = fields({ ...SET, startAtTimes: ["07:00", "07:00"] });

    expect(shownText(page)).toContain("07:00 is set already.");
  });

  it("turns Start again after each reset on and off", () => {
    const change = vi.fn<(windowStart: WindowStartDraft) => void>();
    const page = fields(OFF, change);

    click(page, "label", "Start again after each reset");

    expect(change).toHaveBeenCalledWith({ ...OFF, startAfterReset: true });
  });
});
