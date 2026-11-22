import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckboxList } from "./index.ts";

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
  { value: "0", label: "IndexedDB", aside: <span>Recommended</span> },
  { value: "1", label: "Cookies" },
  { value: "2", label: "Local storage" },
];

describe("CheckboxList", () => {
  it("is a named group of native checkboxes, the checked ones marked", () => {
    act(() =>
      root.render(
        <CheckboxList
          label="Answers"
          options={OPTIONS}
          values={["0", "2"]}
          onChange={vi.fn<(values: readonly string[]) => void>()}
        />,
      ),
    );

    expect(page.querySelector("[role=group]")?.getAttribute("aria-label")).toBe("Answers");
    const boxes = [...page.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes.map(({ checked }) => checked)).toEqual([true, false, true]);
    expect(boxes[0]?.closest("label")?.textContent).toBe("IndexedDBRecommended");
    expect(boxes[0]?.closest("label")?.classList.contains("picked")).toBe(true);
    expect(boxes[1]?.closest("label")?.classList.contains("picked")).toBe(false);
  });

  it("says which values are checked after a box is checked or unchecked, in the options' order", () => {
    const onChange = vi.fn<(values: readonly string[]) => void>();
    act(() =>
      root.render(
        <CheckboxList label="Answers" options={OPTIONS} values={["2"]} onChange={onChange} />,
      ),
    );

    const boxes = page.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    act(() => boxes[0]?.click());
    expect(onChange).toHaveBeenLastCalledWith(["0", "2"]);
    act(() => boxes[2]?.click());
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
