import { act, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RecordActionButton, withActionItems, type RecordAction } from "./record-actions.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAUSE: RecordAction = {
  key: "pause",
  label: "Pause",
  icon: "pause",
  tone: "hold",
  onSelect: () => undefined,
};
const START: RecordAction = {
  key: "start",
  label: "Start",
  icon: "play",
  tone: "go",
  variant: "primary",
  onSelect: () => undefined,
};
const TAKE_OUT: RecordAction = {
  key: "take-out-of-queue",
  label: "Take out of the queue",
  icon: "x",
  tone: "stop",
  variant: "ghost",
  onSelect: () => undefined,
};
const BROWSE_FILES: RecordAction = {
  key: "browse-files",
  label: "Browse files",
  icon: "folder-tree",
  onSelect: () => undefined,
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function rendered(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

function buttonOf(action: RecordAction): HTMLButtonElement {
  const button = rendered(<RecordActionButton action={action} />).querySelector("button");
  if (!button) throw new Error(`No button for ${action.label}`);
  return button;
}

describe("action tones", () => {
  it("colours a toned action's button by its tone and its variant", () => {
    expect([...buttonOf(PAUSE).classList]).toEqual([
      "action-tone-hold",
      "action-tone-on-secondary",
    ]);
  });

  it("marks a primary action as primary, as it keeps its fill and only its icon is coloured", () => {
    expect([...buttonOf(START).classList]).toEqual(["action-tone-go", "action-tone-on-primary"]);
  });

  it("marks a ghost action as ghost, as it keeps its clear surface", () => {
    expect([...buttonOf(TAKE_OUT).classList]).toEqual(["action-tone-stop", "action-tone-on-ghost"]);
  });

  it("gives an action with no tone no tone's class", () => {
    expect(buttonOf(BROWSE_FILES).className).toBe("");
  });

  it("shows each action's icon in its tone in the More menu, and an untoned one plain", () => {
    const items = withActionItems([PAUSE, BROWSE_FILES], []);
    const menu = rendered(
      <>
        {items.map((item, index) => (
          <Fragment key={index}>{"icon" in item ? item.icon : null}</Fragment>
        ))}
      </>,
    );
    const toned = menu.querySelectorAll(".action-tone-icon");
    expect(toned).toHaveLength(1);
    expect(toned[0]?.classList.contains("action-tone-hold")).toBe(true);
    expect(menu.querySelectorAll("svg")).toHaveLength(2);
  });
});
