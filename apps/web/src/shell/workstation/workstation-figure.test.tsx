import {
  focusManager,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { WorkstationLoad } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workstationQueries } from "../../api/workstation.ts";
import { WorkstationFigure } from "./workstation-figure.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
notifyManager.setScheduler((notify) => notify());

const GIB = 1024 ** 3;
const LOAD: WorkstationLoad = {
  cpu: {
    model: "Test CPU",
    speedMhz: 3200,
    cores: 2,
    use: { percent: 23.4, perCore: [10, 36.8] },
    loadAverage: { oneMinute: 1.5, fiveMinutes: 1.2, fifteenMinutes: 1 },
  },
  memory: { totalBytes: 16 * GIB, availableBytes: 4 * GIB, usedBytes: 12 * GIB },
  officeMemoryBytes: GIB / 2,
  uptimeSeconds: 90_000,
};

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Each read is the one the test set: the next poll never answers.
  vi.stubGlobal("fetch", () => new Promise<never>(() => undefined));
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

function render(load: WorkstationLoad): void {
  queryClient.setQueryData(workstationQueries.load().queryKey, load);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <WorkstationFigure />
      </QueryClientProvider>,
    ),
  );
}

function figure(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("The Workstation figure isn't shown.");
  return button;
}

function panel(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Workstation"]');
}

it("shows the CPU use now and the logical cores", () => {
  render(LOAD);

  expect(figure().textContent).toBe("23%CPU · 2 cores");
  expect(figure().getAttribute("aria-label")).toBe("Workstation: 23% CPU, 2 cores");
});

it("opens the panel with CPU, Memory, The Office and Uptime, and closes it on Esc", () => {
  render(LOAD);

  act(() => figure().click());

  const opened = panel();
  expect(opened?.textContent).toContain("Test CPU · 3.2 GHz");
  expect(opened?.textContent).toContain("1.50 · 1.20 · 1.00");
  expect(opened?.querySelectorAll('[aria-label="Use per core"] li')).toHaveLength(2);
  expect(opened?.textContent).toContain("12.0 GB / 16.0 GB");
  expect(opened?.textContent).toContain("0.5 GB");
  expect(opened?.textContent).toContain("1d 1h");
  expect(figure().getAttribute("aria-expanded")).toBe("true");

  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

  expect(panel()).toBeNull();
});

it("closes the panel on a press outside it", () => {
  render(LOAD);
  act(() => figure().click());

  act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));

  expect(panel()).toBeNull();
});

it("says Measuring… rather than 0% before the first CPU measure", () => {
  render({ ...LOAD, cpu: { ...LOAD.cpu, use: null } });

  expect(figure().textContent).toBe("Measuring…· 2 cores");
  act(() => figure().click());
  expect(panel()?.textContent).toContain("Use nowMeasuring…");
  expect(panel()?.textContent).not.toContain("0%");
  expect(panel()?.querySelector('[aria-label="Use per core"]')).toBeNull();
});

it("reads again every 2 s while the tab is visible, and not while it is hidden", async () => {
  vi.useFakeTimers();
  const reads = vi.fn<() => Promise<Response>>(async () => Response.json(LOAD));
  vi.stubGlobal("fetch", reads);
  try {
    render(LOAD);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(reads).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(reads).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(true));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(reads).toHaveBeenCalledTimes(2);
  } finally {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  }
});

it("leaves the load average out where the operating system has none", () => {
  render({ ...LOAD, cpu: { ...LOAD.cpu, loadAverage: null } });

  act(() => figure().click());

  expect(panel()?.textContent).not.toContain("Load average");
});
