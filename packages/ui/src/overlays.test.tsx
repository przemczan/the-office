import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, Drawer } from "./index.ts";

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

function show(element: ReactNode): void {
  act(() => root.render(element));
}

function pressOn(element: Element | null | undefined): void {
  if (!element) throw new Error("Nothing to press");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

const backdrop = (): Element | null | undefined =>
  page.querySelector("[role=dialog]")?.parentElement;

describe.each([
  ["Dialog", (onClose: () => void) => <Dialog title="Remove Project" onClose={onClose} />],
  ["Drawer", (onClose: () => void) => <Drawer title="New Task" onClose={onClose} />],
])("%s", (_, overlay) => {
  it("stays open on a press on its backdrop", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    pressOn(backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on its Close button", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    pressOn(page.querySelector("button[aria-label=Close]"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
