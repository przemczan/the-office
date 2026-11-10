import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageField } from "./message-field.tsx";

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

function field(
  props: Partial<{ canSend: boolean; busyReason: string | undefined }>,
  onSend: () => void,
): ReactNode {
  return (
    <MessageField
      label="Message"
      placeholder="Message Jan…"
      rows={2}
      value="Hello"
      onChange={() => undefined}
      canSend={props.canSend ?? true}
      busyReason={props.busyReason}
      onSend={onSend}
    />
  );
}

function press(init: KeyboardEventInit): boolean {
  const textarea = page.querySelector("textarea");
  if (!textarea) throw new Error("No field");
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    textarea.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function busyLine(): string | null | undefined {
  return page.querySelector('[role="status"]')?.textContent;
}

describe("MessageField", () => {
  it("sends on Enter", () => {
    const onSend = vi.fn<() => void>();
    show(field({}, onSend));
    expect(press({ key: "Enter" })).toBe(true);
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("leaves Shift+Enter to break the line", () => {
    const onSend = vi.fn<() => void>();
    show(field({}, onSend));
    expect(press({ key: "Enter", shiftKey: true })).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("says why on Enter while it can't send, until it can again", () => {
    const onSend = vi.fn<() => void>();
    const busyReason = "Jan is still answering. Send it once they finish.";
    show(field({ canSend: false, busyReason }, onSend));
    expect(busyLine()).toBeUndefined();
    press({ key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(busyLine()).toBe(busyReason);

    show(field({ canSend: true, busyReason: undefined }, onSend));
    expect(busyLine()).toBeUndefined();
    show(field({ canSend: false, busyReason }, onSend));
    expect(busyLine()).toBeUndefined();
  });

  it("does nothing on Enter with nothing to send", () => {
    const onSend = vi.fn<() => void>();
    show(field({ canSend: false }, onSend));
    press({ key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(busyLine()).toBeUndefined();
  });
});
