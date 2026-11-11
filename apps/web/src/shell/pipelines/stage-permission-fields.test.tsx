import type { Role, RoleCardOptions } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentStage } from "./stage-edits.ts";
import { StagePermissionFields } from "./stage-permission-fields.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const implement: AgentStage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Implement the Plan.",
  session: "fresh",
  budget: 250_000,
};

const developer = {
  key: "developer",
  card: {
    name: "Jim",
    title: "Developer",
    permissionProfile: { edit: true, run: "anything", web: true, mcpTools: {} },
  },
  mcpServers: [],
} as unknown as Role;

const options = { knownRoles: [] } as unknown as RoleCardOptions;

afterEach(() => {
  document.body.innerHTML = "";
});

/** Renders the fields for `stage`, and keeps each Stage they answer in `changed`. */
function rendered(stage: AgentStage, changed: AgentStage[]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    createRoot(container).render(
      <StagePermissionFields
        stage={stage}
        role={developer}
        options={options}
        commandKeys={["build", "test", "test-full"]}
        change={(each) => changed.push(each)}
      />,
    );
  });
  return container;
}

function box(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Add a Project command"]',
  );
  if (!input) throw new Error("The Project commands box isn't shown.");
  return input;
}

function typed(input: HTMLInputElement, word: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, word);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

describe("A Stage's Project commands", () => {
  it("keeps the Role card's while none is listed, suggesting the Projects' keys", () => {
    const container = rendered(implement, []);

    expect(box(container).placeholder).toBe("Role default: every Project command");
    expect(container.textContent).toContain("Only these of the Project's commands; never install");
    expect(
      [...container.querySelectorAll("datalist option")].map((option) =>
        option.getAttribute("value"),
      ),
    ).toEqual(["build", "test", "test-full"]);
  });

  it("adds a key on Enter, even one no Project has", () => {
    const changed: AgentStage[] = [];
    const container = rendered(implement, changed);

    typed(box(container), "e2e");

    expect(changed.at(-1)?.permissions).toEqual({ commands: ["e2e"] });
  });

  it("shows each listed key as a chip, and goes back to the Role card's once the last is removed", () => {
    const changed: AgentStage[] = [];
    const container = rendered({ ...implement, permissions: { commands: ["test"] } }, changed);

    expect(
      container.querySelector('[role="group"][aria-label="Project commands"]')?.textContent,
    ).toContain("test");
    expect(
      [...container.querySelectorAll("datalist option")].map((option) =>
        option.getAttribute("value"),
      ),
    ).toEqual(["build", "test-full"]);
    act(() => {
      container.querySelector<HTMLElement>('[aria-label="Remove"]')?.click();
    });

    expect(changed.at(-1)).toEqual(implement);
  });
});
