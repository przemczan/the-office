import { CopilotClient, RuntimeConnection } from "@microsoft/copilot-sdk";
import { engineRead, type EngineReadLimits } from "../shared/engine-read.js";

/** A model the runtime lists for the account, as far as The Office reads it. */
export interface CopilotListedModel {
  /** What a session names it by, such as `claude-sonnet-4.5`. */
  readonly id: string;
  /** Absent when no policy applies; a model `disabled` by policy can't run. */
  readonly policy?: { readonly state: string } | undefined;
}

/** A Copilot CLI runtime started on one engine's folder to list its models alone. */
export interface CopilotModelRuntime {
  listModels(): Promise<readonly CopilotListedModel[]>;
  close(): Promise<void>;
}

/**
 * Starts a runtime on the folder `home`, signed in by `token` when one is kept, else by the
 * folder's own sign-in: the pinned SDK's in the service, a stand-in in tests.
 */
export type OpenCopilotModelRuntime = (
  home: string,
  token: string | undefined,
) => Promise<CopilotModelRuntime>;

/** How long the runtime has to stop before it is killed. */
const STOP_TIMEOUT_MS = 5000;

/**
 * Runtimes of the pinned `@microsoft/copilot-sdk` for a model list, each its own process over
 * stdio with `COPILOT_HOME` the engine's folder and `environment` (as `copilotEnvironment` gives
 * it), signed in as a session is; no session runs on it.
 */
export function sdkCopilotModelRuntimes(
  environment: Readonly<Record<string, string>>,
): OpenCopilotModelRuntime {
  return async (home, token) => {
    const client = new CopilotClient({
      mode: "empty",
      runtime: RuntimeConnection.forSpawnedStdio({ env: { ...environment }, baseDirectory: home }),
      github: token === undefined ? { useLoggedInUser: true } : { token, useLoggedInUser: false },
      observability: { logLevel: "warning" },
    });
    const runtime: CopilotModelRuntime = {
      listModels: () => client.listModels(),
      close: () => stopped(client),
    };
    try {
      await client.start();
    } catch (error) {
      await runtime.close();
      throw error;
    }
    return runtime;
  };
}

/**
 * Lists the models the account offers on a runtime started for the read alone (spec §5.4.5,
 * "Models an engine lists"), with no session and no model call (`listedCopilotModels`). The
 * runtime ends before the read answers, however it went (`engineRead`), even one still starting
 * when the read ended.
 */
export async function listModelsOnCopilotRuntime(
  open: OpenCopilotModelRuntime,
  home: string,
  token: string | undefined,
  limits: EngineReadLimits,
): Promise<readonly string[] | undefined> {
  let opening: Promise<CopilotModelRuntime> | undefined;
  let runtime: CopilotModelRuntime | undefined;
  return engineRead(
    limits,
    async () => {
      opening = open(home, token);
      runtime = await opening;
      return listedCopilotModels(await runtime.listModels());
    },
    async () => {
      if (runtime !== undefined) {
        await runtime.close();
        return;
      }
      // Still starting when the read ended: it ends once started, without holding the read up.
      void opening?.then(
        (late) => late.close(),
        () => undefined,
      );
    },
  );
}

/**
 * The models a Copilot CLI account lists, by the ids a session names them by, those its policy
 * disables left out, each once in the runtime's order; undefined when none is left, as on an
 * account signed in by a token that lists none. Auto is the domain's (`offeredModels`).
 */
export function listedCopilotModels(
  models: readonly CopilotListedModel[],
): readonly string[] | undefined {
  const ids = new Set(
    models.filter((model) => model.policy?.state !== "disabled").map((model) => model.id),
  );
  return ids.size === 0 ? undefined : [...ids];
}

async function stopped(client: CopilotClient): Promise<void> {
  const stop = await Promise.race([
    client.stop().then(
      () => true,
      () => false,
    ),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS).unref()),
  ]);
  if (!stop) await client.forceStop().catch(() => undefined);
}
