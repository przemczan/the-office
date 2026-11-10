import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "./index.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Row {
  readonly id: string;
  readonly name: string;
  readonly month: string;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", header: "Initiative" },
  { key: "restore", header: "", align: "right", render: () => "Restore" },
];

const ROWS: Row[] = [
  { id: "1", name: "Offline sync", month: "November 2026" },
  { id: "2", name: "Usage exports", month: "November 2026" },
  { id: "3", name: "Slack notifications", month: "October 2026" },
];

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
  vi.restoreAllMocks();
});

/** Lays the table out `width` pixels wide, as jsdom lays out nothing. */
function laidOutAt(width: number): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
}

function render(): void {
  act(() => root.render(<DataTable columns={COLUMNS} rows={ROWS} groupOf={(row) => row.month} />));
}

describe("DataTable", () => {
  it("draws a line above each run of rows in one group", () => {
    render();

    const lines = [...page.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(lines).toEqual([
      "November 2026",
      "Offline syncRestore",
      "Usage exportsRestore",
      "October 2026",
      "Slack notificationsRestore",
    ]);
  });

  it("is a table with its head on a wide page", () => {
    laidOutAt(900);
    render();

    expect(page.querySelector<HTMLElement>("thead")?.style.display).toBe("");
    expect(page.querySelector<HTMLElement>("tbody tr:nth-child(2)")?.style.display).toBe("");
  });

  it("makes each row a block under 640px, the first column on a line of its own", () => {
    laidOutAt(390);
    render();

    expect(page.querySelector<HTMLElement>("thead")?.style.display).toBe("none");
    const row = page.querySelector<HTMLElement>("tbody tr:nth-child(2)");
    expect(row?.style.display).toBe("flex");
    const [name, restore] = [...(row?.querySelectorAll<HTMLElement>("td") ?? [])];
    expect(name?.style.flexBasis).toBe("100%");
    expect(restore?.style.marginLeft).toBe("auto");
  });
});
