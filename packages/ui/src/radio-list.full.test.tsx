import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RadioList } from "./index.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => root.unmount());
  page.remove();
});

const OPTIONS = [
  { value: "0", label: "Keep the query string", aside: <span>Recommended</span> },
  { value: "1", label: "A cookie" },
];

describe("RadioList", () => {
  it("is a named group of native radios, the picked one checked and marked", () => {
    act(() =>
      root.render(
        <RadioList
          label="Answers"
          name="answer"
          options={OPTIONS}
          value="0"
          onChange={vi.fn<(value: string) => void>()}
        />,
      ),
    );

    expect(page.querySelector("[role=radiogroup]")?.getAttribute("aria-label")).toBe("Answers");
    const radios = [...page.querySelectorAll<HTMLInputElement>("input[type=radio]")];
    expect(radios.map(({ checked }) => checked)).toEqual([true, false]);
    expect(radios[0]?.closest("label")?.textContent).toBe("Keep the query stringRecommended");
    expect(radios[0]?.closest("label")?.classList.contains("picked")).toBe(true);
  });

  it("says which value was picked", () => {
    const onChange = vi.fn<(value: string) => void>();
    act(() =>
      root.render(
        <RadioList label="Answers" name="answer" options={OPTIONS} value="0" onChange={onChange} />,
      ),
    );

    act(() => page.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]?.click());

    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("clears the pick when the picked one is pressed again, if clearable", () => {
    const onChange = vi.fn<(value: string) => void>();
    act(() =>
      root.render(
        <RadioList
          label="Reason"
          name="reason"
          options={OPTIONS}
          value="1"
          onChange={onChange}
          clearable
        />,
      ),
    );

    act(() => page.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]?.click());
    expect(onChange).toHaveBeenCalledWith("");
  });
});
