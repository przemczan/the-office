import { useQuery } from "@tanstack/react-query";
import type { EngineEdit } from "@the-office/contracts";
import { Badge, Button, Icon, Menu, PickList, PickListGroup, PickListItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { engineAccountQuery } from "../../../api/engine.ts";
import {
  ENGINE_KIND_ICONS,
  ENGINE_KIND_LABELS,
  ENGINE_KINDS,
} from "../../../shell/engine-words.ts";
import {
  apiEndpointSummary,
  engineCalled,
  engineGroupsOf,
  ENGINE_GROUP_TITLES,
  sameSelection,
  signedInEngineSummary,
  type EngineSelection,
  type SignedInEngine,
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
 * Settings › Engines' list: "Add an engine" in its head, a menu of the kinds, each selecting the
 * engine it adds, then a row per engine under a heading per engine type, the Claude Code engines
 * first, then the Codex, Copilot CLI and Gemini CLI engines, then the API endpoints, as Save sends
 * them.
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
    <PickList
      name="Engines"
      count={rows.length}
      action={<AddEngineMenu add={add} />}
      empty="No engine yet. Add a Claude Code, Codex, Copilot CLI or Gemini CLI engine or an API endpoint with Add an engine."
      note="Each Claude Code engine is one Claude account, each Codex engine one OpenAI account, each Copilot CLI engine one GitHub account, each Gemini CLI engine one Gemini API key, each API endpoint a server on the OpenAI-compatible API, such as a local LLM."
    >
      {engineGroupsOf(rows).map((group) => (
        <PickListGroup key={group.kind} title={ENGINE_GROUP_TITLES[group.kind]}>
          {group.rows.map((row) => (
            <EngineListItem
              key={`${row.selection.kind}-${row.selection.index}`}
              row={row}
              picked={sameSelection(shown, row.selection)}
              select={() => select(row.selection)}
            />
          ))}
        </PickListGroup>
      ))}
    </PickList>
  );
}

function AddEngineMenu({
  add,
}: {
  readonly add: Readonly<Record<EngineEdit["kind"], () => void>>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
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
      items={ENGINE_KINDS.map((kind) => ({
        label: ENGINE_KIND_LABELS[kind],
        icon: <Icon name={ENGINE_KIND_ICONS[kind]} size={14} />,
        onSelect: add[kind],
      }))}
    />
  );
}

function EngineListItem({
  row: { engine, officeDefault, problem },
  picked,
  select,
}: {
  readonly row: EngineRow;
  readonly picked: boolean;
  readonly select: () => void;
}): ReactNode {
  return (
    <PickListItem
      picked={picked}
      icon={{
        glyph: <Icon name={ENGINE_KIND_ICONS[engine.kind]} size={15} strokeWidth={1.6} />,
        label: ENGINE_KIND_LABELS[engine.kind],
      }}
      name={engineCalled(engine)}
      line={<EngineSummary engine={engine} />}
      aside={
        officeDefault && (
          <Badge size="sm" tone="accent">
            Office default
          </Badge>
        )
      }
      warning={problem}
      onPick={select}
    />
  );
}

function EngineSummary({ engine }: { readonly engine: EngineEdit }): ReactNode {
  if (engine.kind === "openai-compatible-api") return apiEndpointSummary(engine);
  if (engine.id === undefined) return signedInEngineSummary(engine, "not-saved");
  return <SavedEngineSummary engineId={engine.id} engine={engine} />;
}

/**
 * A saved Claude Code, Codex, Copilot CLI or Gemini CLI engine's line, its account read as its
 * Account tab reads it.
 */
function SavedEngineSummary({
  engineId,
  engine,
}: {
  readonly engineId: string;
  readonly engine: SignedInEngine;
}): ReactNode {
  const account = useQuery(engineAccountQuery(engineId));
  return signedInEngineSummary(engine, account.data);
}
