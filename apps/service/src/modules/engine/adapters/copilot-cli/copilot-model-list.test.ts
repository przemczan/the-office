import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { CopilotCliToken } from "../../domain/copilot-cli-token.js";
import type { CopilotCliEngine } from "../../domain/engines.js";
import { EngineReadTimedOut } from "../../ports/agent-engine.js";
import { CopilotSdkEngine } from "./copilot-cli-engine.js";
import {
  listedCopilotModels,
  listModelsOnCopilotRuntime,
  type CopilotListedModel,
  type OpenCopilotModelRuntime,
} from "./copilot-model-list.js";

const TOKEN = "github_pat_for_the_tests_only";

const ENGINE: CopilotCliEngine = {
  id: "copilot-tests",
  name: "Copilot",
  kind: "copilot-cli",
  defaultModel: "auto",
  defaultEffort: null,
  token: CopilotCliToken.of(TOKEN),
};

const MODELS: readonly CopilotListedModel[] = [
  { id: "auto" },
  { id: "claude-sonnet-4.5", policy: { state: "enabled" } },
  { id: "gpt-5", policy: { state: "disabled" } },
  { id: "gpt-5-mini", policy: { state: "unconfigured" } },
  { id: "claude-sonnet-4.5" },
];

/** A stand-in runtime: what it was started with, whether it was closed, and how it answers. */
function standIn(answer: () => Promise<readonly CopilotListedModel[]>, startsIn = 0) {
  const started: { home: string; token: string | undefined }[] = [];
  const close = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const open: OpenCopilotModelRuntime = async (home, token) => {
    started.push({ home, token });
    await new Promise((resolve) => setTimeout(resolve, startsIn));
    return { listModels: answer, close };
  };
  return { open, started, close };
}

const limits = (timeoutMs?: number) => ({
  what: "Listing the models",
  signal: new AbortController().signal,
  timeoutMs,
});

describe("listedCopilotModels", () => {
  it("names each model by its id, once each in the runtime's order, those its policy disables left out", () => {
    expect(listedCopilotModels(MODELS)).toEqual(["auto", "claude-sonnet-4.5", "gpt-5-mini"]);
  });

  it("answers undefined when the account lists no model it may run", () => {
    expect(listedCopilotModels([])).toBeUndefined();
    expect(listedCopilotModels([{ id: "gpt-5", policy: { state: "disabled" } }])).toBeUndefined();
  });
});

describe("listModelsOnCopilotRuntime", () => {
  it("lists on a runtime started for the read, then closes it", async () => {
    const runtime = standIn(() => Promise.resolve(MODELS));

    await expect(
      listModelsOnCopilotRuntime(runtime.open, "/engines/copilot", TOKEN, limits()),
    ).resolves.toEqual(["auto", "claude-sonnet-4.5", "gpt-5-mini"]);
    expect(runtime.started).toEqual([{ home: "/engines/copilot", token: TOKEN }]);
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("closes the runtime when the list fails", async () => {
    const runtime = standIn(() => Promise.reject(new Error("not signed in")));

    await expect(
      listModelsOnCopilotRuntime(runtime.open, "/engines/copilot", undefined, limits()),
    ).rejects.toThrow("not signed in");
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("closes a runtime that answers too late, throwing EngineReadTimedOut", async () => {
    const runtime = standIn(() => new Promise(() => undefined));

    await expect(
      listModelsOnCopilotRuntime(runtime.open, "/engines/copilot", undefined, limits(100)),
    ).rejects.toBeInstanceOf(EngineReadTimedOut);
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("closes a runtime still starting when the read timed out, once it has started", async () => {
    const runtime = standIn(() => Promise.resolve(MODELS), 300);

    await expect(
      listModelsOnCopilotRuntime(runtime.open, "/engines/copilot", undefined, limits(100)),
    ).rejects.toBeInstanceOf(EngineReadTimedOut);
    await vi.waitFor(() => expect(runtime.close).toHaveBeenCalledOnce());
  });
});

describe("CopilotSdkEngine.listModels", () => {
  let officeData: string;

  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-copilot-models-"));
  });

  afterEach(async () => {
    await rm(officeData, { recursive: true, force: true });
  });

  it("lists on the engine's folder, signed in by its kept token, or by the folder's own sign-in", async () => {
    const runtime = standIn(() => Promise.resolve(MODELS));
    const engine = new CopilotSdkEngine(
      new OfficeDataDirectory(officeData),
      undefined,
      runtime.open,
    );

    await expect(engine.listModels(ENGINE, new AbortController().signal)).resolves.toEqual([
      "auto",
      "claude-sonnet-4.5",
      "gpt-5-mini",
    ]);
    await engine.listModels({ ...ENGINE, token: null }, new AbortController().signal);

    const home = join(officeData, "engines", ENGINE.id);
    expect(runtime.started).toEqual([
      { home, token: TOKEN },
      { home, token: undefined },
    ]);
  });

  it("answers undefined for a token-signed account that lists no model, so Auto stands", async () => {
    const runtime = standIn(() => Promise.resolve([]));
    const engine = new CopilotSdkEngine(
      new OfficeDataDirectory(officeData),
      undefined,
      runtime.open,
    );

    await expect(engine.listModels(ENGINE, new AbortController().signal)).resolves.toBeUndefined();
    expect(runtime.close).toHaveBeenCalledOnce();
  });
});
