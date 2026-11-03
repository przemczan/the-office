import { useQuery } from "@tanstack/react-query";
import type { EngineEdit } from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { engineAccountQuery } from "../../../api/engine.ts";
import {
  apiEndpointSummary,
  claudeCodeEngineSummary,
  engineCalled,
  ENGINE_KIND_LABELS,
  sameSelection,
  type EngineSelection,
} from "./engine-list-words.ts";

/** A row of the list: the engine, where it is in the draft, and what marks it. */
export interface EngineRow {
  readonly selection: EngineSelection;
  readonly engine: EngineEdit;
  readonly officeDefault: boolean;
  /** What holds Save or the service would refuse, shown as a warning mark. */
  readonly problem: string | undefined;
}

/**
 * Settings › Engines' list: a row per engine, the Claude Code engines first, as Save sends them,
 * and the two Adds, each selecting the engine it adds.
 */
export function EngineList({
  rows,
  shown,
  select,
  addClaudeCodeEngine,
  addApiEndpoint,
}: {
  readonly rows: readonly EngineRow[];
  readonly shown: EngineSelection | undefined;
  readonly select: (selection: EngineSelection) => void;
  readonly addClaudeCodeEngine: () => void;
  readonly addApiEndpoint: () => void;
}): ReactNode {
  return (
    <div className="library-list">
      <nav aria-label="Engines">
        {rows.map((row) => (
          <EngineListItem
            key={`${row.selection.kind}-${row.selection.index}`}
            row={row}
            active={sameSelection(shown, row.selection)}
            select={() => select(row.selection)}
          />
        ))}
      </nav>
      {rows.length === 0 && <p className="settings-note engine-list-empty">No engine yet.</p>}
      <div className="library-list-actions">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Icon name="plus" size={14} />}
          onClick={addClaudeCodeEngine}
        >
          Add a Claude Code engine
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Icon name="plus" size={14} />}
          onClick={addApiEndpoint}
        >
          Add an API endpoint
        </Button>
      </div>
      <p className="settings-note engine-list-note">
        Each Claude Code engine is one Claude account, each API endpoint a server on the
        OpenAI-compatible API, such as a local LLM.
      </p>
    </div>
  );
}

function EngineListItem({
  row: { engine, officeDefault, problem },
  active,
  select,
}: {
  readonly row: EngineRow;
  readonly active: boolean;
  readonly select: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={active ? "library-item engine-item active" : "library-item engine-item"}
      aria-current={active ? "true" : undefined}
      onClick={select}
    >
      <span className="library-item-words">
        <span className="engine-item-name">
          <span className="library-item-name">{engineCalled(engine)}</span>
          {officeDefault && (
            <Badge size="sm" tone="accent">
              Office default
            </Badge>
          )}
        </span>
        <span className="library-item-stages">
          {ENGINE_KIND_LABELS[engine.kind]} · <EngineSummary engine={engine} />
        </span>
      </span>
      {problem && (
        <span className="library-item-flag" title={problem} aria-label={problem}>
          <Icon name="triangle-alert" size={14} />
        </span>
      )}
    </button>
  );
}

function EngineSummary({ engine }: { readonly engine: EngineEdit }): ReactNode {
  if (engine.kind === "openai-compatible-api") return apiEndpointSummary(engine);
  if (engine.id === undefined) return claudeCodeEngineSummary(engine.defaultModel, "not-saved");
  return <SavedClaudeCodeSummary engineId={engine.id} defaultModel={engine.defaultModel} />;
}

/** A saved Claude Code engine's line, its account read as its Account tab reads it. */
function SavedClaudeCodeSummary({
  engineId,
  defaultModel,
}: {
  readonly engineId: string;
  readonly defaultModel: string;
}): ReactNode {
  const account = useQuery(engineAccountQuery(engineId));
  return claudeCodeEngineSummary(defaultModel, account.data);
}
