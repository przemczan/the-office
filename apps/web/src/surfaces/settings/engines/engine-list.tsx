import { useQuery } from "@tanstack/react-query";
import type { EngineEdit } from "@the-office/contracts";
import { Badge, Button, Icon, Menu } from "@the-office/ui";
import { useState, type ReactNode } from "react";
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
 * Settings › Engines' list: "Add an engine" on top, a menu of the kinds, each selecting the engine
 * it adds, then a row per engine, the Claude Code engines first, as Save sends them.
 */
export function EngineList({
  rows,
  shown,
  select,
  add,
}: {
  readonly rows: readonly EngineRow[];
  readonly shown: EngineSelection | undefined;
  readonly select: (selection: EngineSelection) => void;
  /** Adds an engine of each kind; a new kind is one more entry in the menu. */
  readonly add: Readonly<Record<EngineEdit["kind"], () => void>>;
}): ReactNode {
  return (
    <div className="library-list">
      <AddEngineMenu add={add} />
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
      <p className="settings-note engine-list-note">
        Each Claude Code engine is one Claude account, each API endpoint a server on the
        OpenAI-compatible API, such as a local LLM.
      </p>
    </div>
  );
}

function AddEngineMenu({
  add,
}: {
  readonly add: Readonly<Record<EngineEdit["kind"], () => void>>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const kinds = Object.keys(ENGINE_KIND_LABELS) as EngineEdit["kind"][];
  return (
    <div className="engine-list-add">
      <Menu
        open={open}
        onOpenChange={setOpen}
        align="start"
        width={220}
        trigger={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="plus" size={14} />}
            iconRight={<Icon name="chevron-down" size={14} />}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            Add an engine
          </Button>
        }
        items={kinds.map((kind) => ({ label: ENGINE_KIND_LABELS[kind], onSelect: add[kind] }))}
      />
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
