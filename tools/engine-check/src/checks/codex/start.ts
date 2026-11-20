import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import { CODEX_CHECK_EFFORT, CODEX_CHECK_MODEL } from "../../codex/options.ts";
import { pinnedCodexVersion } from "../../codex/pinned-codex.ts";
import type { ConfigReadResponse, Model, ModelListResponse } from "../../codex/protocol.ts";
import { sortedNames } from "../observations.ts";
import { isWithin, samePath } from "../paths.ts";

/**
 * The Codex engine's start without a model call (spec §5.4 Defaults, the Codex engine): the pinned
 * app-server on the account folder as `CODEX_HOME`, its sign-in, the check model listed, the
 * settings read only from that folder, and a thread started with the Office's options.
 */
export const codexStartCheck: Check = {
  id: "codex.start",
  title:
    "the pinned app-server starts on the account folder, signed in, with the check model and nothing read from ~/.codex",
  async run({ sandbox, startCodexSession }) {
    const repository = await sandbox.createRepository();
    // A Project's own Codex settings, which a trusted project's folder would add as a layer.
    await mkdir(join(repository, ".codex"));
    await writeFile(join(repository, ".codex", "config.toml"), 'model_verbosity = "high"\n');
    const session = await startCodexSession({ repository });
    const models = await listModels((params) => session.request("model/list", params));
    const config = (await session.request("config/read", {
      includeLayers: true,
      cwd: repository,
    })) as ConfigReadResponse;
    const layerFiles = (config.layers ?? []).flatMap((layer) =>
      layer.name.file === undefined ? [] : [layer.name.file],
    );
    const opened = await session.startThread();
    const afterStart = (await session.request("config/read", {
      includeLayers: true,
      cwd: repository,
    })) as ConfigReadResponse;
    const checkModel = models.find((model) => model.id === CODEX_CHECK_MODEL);
    return {
      // The user agent is `<client>/<version> (<system>) …`; `codex --version` would start a process on ~/.codex.
      versionMatchesPin: session.initializeResponse.userAgent.includes(`/${pinnedCodexVersion()} `),
      codexHomeIsTheFolder: samePath(session.initializeResponse.codexHome, session.codexHome),
      signIn: session.account?.type ?? "none",
      checkModelListed: checkModel !== undefined,
      checkEffortSupported:
        checkModel?.supportedReasoningEfforts.some(
          (effort) => effort.reasoningEffort === CODEX_CHECK_EFFORT,
        ) ?? false,
      configLayers: sortedNames((config.layers ?? []).map((layer) => layer.name.type)),
      userConfigInFolder: layerFiles.some((file) => isWithin(file, session.codexHome)),
      readFromHomeCodex: layerFiles.some((file) => isWithin(file, join(homedir(), ".codex"))),
      projectTrustedByThreadStart:
        Object.entries(afterStart.config.projects ?? {}).find(([path]) =>
          samePath(path, repository),
        )?.[1].trust_level ?? "none",
      projectConfigRead: {
        beforeThread: config.config.model_verbosity === "high",
        afterThread: afterStart.config.model_verbosity === "high",
      },
      projectLayerDisabled:
        afterStart.layers?.some(
          (layer) => layer.name.type === "project" && typeof layer.disabledReason === "string",
        ) ?? false,
      thread: {
        model: opened.model,
        approvalPolicy: opened.approvalPolicy,
        sandbox: opened.sandbox.type,
        reasoningEffort: opened.reasoningEffort,
      },
    };
  },
};

async function listModels(
  page: (params: { cursor: string | null }) => Promise<unknown>,
): Promise<Model[]> {
  const models: Model[] = [];
  let cursor: string | null = null;
  do {
    const answer = (await page({ cursor })) as ModelListResponse;
    models.push(...answer.data);
    cursor = answer.nextCursor;
  } while (cursor !== null);
  return models;
}
