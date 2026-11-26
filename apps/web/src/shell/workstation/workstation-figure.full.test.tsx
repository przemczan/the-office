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

function render(load: WorkstationLoad, updatedAt?: number): void {
  queryClient.setQueryData(workstationQueries.load().queryKey, load, { updatedAt });
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

  // Its label is Workstation, or CPU on a tight strip: the CSS shows one of the two.
  expect(figure().textContent).toBe("WorkstationCPU23%· 2 cores");
  expect(figure().getAttribute("aria-label")).toBe("Workstation: 23% CPU, 2 cores");
});

it("leaves the strip's % untinted while the CPU is calm, and tints it when busy or high", () => {
  render(LOAD);
  expect(figure().querySelector("b")?.dataset["level"]).toBeUndefined();

  render({ ...LOAD, cpu: { ...LOAD.cpu, use: { percent: 72, perCore: [70, 74] } } });
  expect(figure().querySelector("b")?.dataset["level"]).toBe("busy");

  render({ ...LOAD, cpu: { ...LOAD.cpu, use: { percent: 91, perCore: [90, 92] } } });
  expect(figure().querySelector("b")?.dataset["level"]).toBe("high");
});

it("opens the panel with the CPU and Memory tiles, the cores, the memory split and the foot, and closes it on Esc", () => {
  render(LOAD);

  act(() => figure().click());

  const opened = panel();
  expect(opened?.textContent).toContain("Test CPU · 3.2 GHz");
  expect(opened?.querySelector('[aria-label="CPU"]')?.textContent).toBe("CPU23%2 cores");
  expect(opened?.querySelector('[aria-label="Memory"]')?.textContent).toBe(
    "Memory75%Used12.0 GB / 16.0 GB",
  );
  const cores = opened?.querySelectorAll<HTMLElement>('[aria-label="Use per core"] li');
  expect([...(cores ?? [])].map((core) => [core.title, core.dataset["level"]])).toEqual([
    ["Core 1: 10%", "calm"],
    ["Core 2: 37%", "calm"],
  ]);
  expect(opened?.querySelector('[aria-label="Memory in use"]')?.textContent).toBe(
    "The Office 0.5 GBOther used 11.5 GBAvailable 4.0 GB",
  );
  expect(opened?.querySelector<HTMLElement>('[aria-label="Memory"]')?.dataset["level"]).toBe(
    "busy",
  );
  expect(opened?.textContent).toContain("Load average1.50 · 1.20 · 1.001, 5, 15 min");
  expect(opened?.textContent).toContain("Up for1d 1h");
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

  expect(figure().textContent).toBe("WorkstationCPUMeasuring…· 2 cores");
  act(() => figure().click());
  expect(panel()?.querySelector('[aria-label="CPU"]')?.textContent).toBe("CPUMeasuring…2 cores");
  expect(panel()?.textContent).not.toContain("0%");
  expect(
    panel()?.querySelector<HTMLElement>('[aria-label="CPU"]')?.dataset["level"],
  ).toBeUndefined();
  expect(panel()?.querySelector('[aria-label="Use per core"]')).toBeNull();
});

it("draws each tile's sparkline once there are two reads, kept while the panel was closed", () => {
  render(LOAD, 1);
  render({ ...LOAD, cpu: { ...LOAD.cpu, use: { percent: 40, perCore: [30, 50] } } }, 2);

  act(() => figure().click());

  expect(panel()?.querySelectorAll(".shell-workstation-sparkline")).toHaveLength(2);
});

it("draws no sparkline from a single read", () => {
  render(LOAD, 1);

  act(() => figure().click());

  expect(panel()?.querySelector(".shell-workstation-sparkline")).toBeNull();
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
