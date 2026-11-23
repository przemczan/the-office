import type { ApiEngine, EngineEdit, EngineId } from "@the-office/contracts";
import { Button, Card, Tabs } from "@the-office/ui";
import type { ReactNode } from "react";
import { ENGINE_KIND_ICONS, ENGINE_KIND_LABELS } from "../../../shell/engine-words.ts";
import { SettingsCardTitle } from "../settings-card-parts.tsx";
import { ApiEndpointFields } from "./api-endpoint-fields.tsx";
import { ClaudeCodeEngineAccount } from "./claude-code-engine-account.tsx";
import { ClaudeCodeEngineFields } from "./claude-code-engine-fields.tsx";
import { CodexEngineAccount } from "./codex-engine-account.tsx";
import { CodexEngineFields } from "./codex-engine-fields.tsx";
import { CopilotCliEngineAccount } from "./copilot-cli-engine-account.tsx";
import { CopilotCliEngineFields } from "./copilot-cli-engine-fields.tsx";
import { GeminiCliEngineAccount } from "./gemini-cli-engine-account.tsx";
import { GeminiCliEngineFields } from "./gemini-cli-engine-fields.tsx";
import {
  ENGINE_TAB_LABELS,
  engineCalled,
  engineTabsOf,
  type EngineTab,
} from "./engine-list-words.ts";
import type { PricedModel } from "./engine-settings-draft.ts";
import {
  ApiEndpointModels,
  ClaudeModelPrices,
  CodexModelPrices,
  PerEngineModelPrices,
  type PriceFields,
} from "./engine-prices.tsx";

/**
 * The selected engine: its name with Remove, and its tabs: Settings, a Claude Code, Codex or
 * Copilot CLI engine's Account, and Models and prices.
 */
export function EngineDetail({
  engine,
  tab,
  selectTab,
  claudeModels,
  savedEndpoint,
  pricedModels,
  draftedId,
  prices,
  windowStart,
  change,
  remove,
}: {
  readonly engine: EngineEdit;
  readonly tab: EngineTab;
  readonly selectTab: (tab: EngineTab) => void;
  readonly claudeModels: readonly string[];
  /** The API endpoint as saved, undefined for one not saved yet or another kind of engine. */
  readonly savedEndpoint: ApiEngine | undefined;
  /** The models its Models and prices prices. */
  readonly pricedModels: readonly PricedModel[];
  /** The id Save gives it: empty while a new one has no name. */
  readonly draftedId: EngineId;
  readonly prices: PriceFields;
  /** Its Window start, under its fields on the Settings tab; none on an engine without usage windows. */
  readonly windowStart: ReactNode;
  readonly change: (edit: EngineEdit) => void;
  /** Drops one not saved yet from the draft; opens the remove dialog for a saved one. */
  readonly remove: () => void;
}): ReactNode {
  const called = engineCalled(engine);
  return (
    <Card
      title={<SettingsCardTitle icon={ENGINE_KIND_ICONS[engine.kind]}>{called}</SettingsCardTitle>}
      subtitle={ENGINE_KIND_LABELS[engine.kind]}
      actions={
        <Button variant="danger-ghost" size="sm" onClick={remove}>
          Remove {called}
        </Button>
      }
    >
      <div className="engine-detail" role="group" aria-label={called}>
        <Tabs
          tabs={engineTabsOf(engine.kind).map((value) => ({
            value,
            label: ENGINE_TAB_LABELS[value],
          }))}
          value={tab}
          onChange={(value) =>
            selectTab(engineTabsOf(engine.kind).find((each) => each === value) ?? "settings")
          }
        />
        {engine.kind === "claude-code" ? (
          tab === "settings" ? (
            <ClaudeCodeEngineFields edit={engine} claudeModels={claudeModels} change={change} />
          ) : tab === "account" ? (
            engine.id === undefined ? (
              <p className="settings-note">
                It has no folder to sign in yet: Save, then sign it in to its Claude account here.
              </p>
            ) : (
              <ClaudeCodeEngineAccount key={engine.id} engineId={engine.id} />
            )
          ) : (
            <ClaudeModelPrices models={pricedModels} prices={prices} />
          )
        ) : engine.kind === "codex" ? (
          tab === "settings" ? (
            <CodexEngineFields edit={engine} change={change} />
          ) : tab === "account" ? (
            engine.id === undefined ? (
              <p className="settings-note">
                It has no folder to sign in yet: Save, then sign it in here, with ChatGPT or an
                OpenAI API key.
              </p>
            ) : (
              <CodexEngineAccount key={engine.id} engineId={engine.id} />
            )
          ) : (
            <CodexModelPrices models={pricedModels} prices={prices} />
          )
        ) : engine.kind === "copilot-cli" ? (
          tab === "settings" ? (
            <CopilotCliEngineFields edit={engine} change={change} />
          ) : tab === "account" ? (
            engine.id === undefined ? (
              <p className="settings-note">
                It has no account to sign in yet: Save, then sign it in here, with GitHub or a
                token.
              </p>
            ) : (
              <CopilotCliEngineAccount key={engine.id} engineId={engine.id} />
            )
          ) : (
            <PerEngineModelPrices models={pricedModels} called={called} prices={prices} />
          )
        ) : engine.kind === "gemini-cli" ? (
          tab === "settings" ? (
            <GeminiCliEngineFields edit={engine} change={change} />
          ) : tab === "account" ? (
            engine.id === undefined ? (
              <p className="settings-note">
                It has no key yet: Save, then paste a Gemini API key from Google AI Studio here.
              </p>
            ) : (
              <GeminiCliEngineAccount key={engine.id} engineId={engine.id} />
            )
          ) : (
            <PerEngineModelPrices models={pricedModels} called={called} prices={prices} />
          )
        ) : tab === "prices" ? (
          <ApiEndpointModels
            edit={engine}
            engineId={draftedId}
            called={called}
            change={change}
            prices={prices}
          />
        ) : (
          <ApiEndpointFields edit={engine} saved={savedEndpoint} change={change} />
        )}
        {tab === "settings" && windowStart}
      </div>
    </Card>
  );
}
