import type { BoardFilters, Initiative, Priority } from "@the-office/contracts";
import { Button, Icon, Input, Select, Switch } from "@the-office/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PRIORITY_ICONS, PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { boardFiltersOf, hasBoardFilters, withBoardFilter } from "./board-filters.ts";
import { SavedViewsRow } from "./saved-views.tsx";

const PRIORITIES: readonly Priority[] = ["high", "normal", "low"];

/** Fold all and Unfold all, offered while more than one group shows and none is picked. */
export interface GroupsFolding {
  /** Every group shown is folded, so the button unfolds them. */
  readonly allFolded: boolean;
  readonly onFoldAll: (open: boolean) => void;
}

/**
 * The board's filters (prototypes/app/work.js `filterBar`): search, priority, Initiative, Blocked,
 * and the Saved views of them; then, apart, Group by Initiative, which lays the board out and
 * narrows nothing.
 */
export function FilterBar({
  filters,
  initiatives,
  onChange,
  grouped,
  onGroupedChange,
  folding,
}: {
  readonly filters: BoardFilters;
  readonly initiatives: readonly Initiative[];
  readonly onChange: (filters: BoardFilters) => void;
  readonly grouped: boolean;
  readonly onGroupedChange: (grouped: boolean) => void;
  /** Undefined while Fold all isn't offered. */
  readonly folding: GroupsFolding | undefined;
}): ReactNode {
  return (
    <div className="board-filters" role="search" aria-label="Filter the board">
      <div className="board-filters-row">
        <SearchBox
          query={filters.query ?? ""}
          onChange={(query) => onChange(withBoardFilter(filters, "query", query))}
        />
        <div className="board-filters-group" role="group" aria-label="Priority">
          {PRIORITIES.map((priority) => (
            <FilterChip
              key={priority}
              on={filters.priority === priority}
              onClick={() =>
                onChange(
                  withBoardFilter(
                    filters,
                    "priority",
                    filters.priority === priority ? undefined : priority,
                  ),
                )
              }
            >
              <Icon name={priority === "normal" ? "minus" : PRIORITY_ICONS[priority]} size={13} />
              {PRIORITY_NAMES[priority]}
            </FilterChip>
          ))}
        </div>
        <Select
          aria-label="Initiative"
          size="sm"
          value={filters.initiative ?? ""}
          options={[
            { value: "", label: "Any Initiative" },
            ...initiatives.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={(initiative) => onChange(withBoardFilter(filters, "initiative", initiative))}
        />
        <FilterChip
          on={filters.blocked === true}
          onClick={() =>
            onChange(withBoardFilter(filters, "blocked", filters.blocked ? undefined : true))
          }
        >
          <Icon name="lock" size={13} />
          Blocked
        </FilterChip>
        {hasBoardFilters(filters) && (
          <Button size="sm" variant="ghost" onClick={() => onChange({})}>
            Clear
          </Button>
        )}
        <div className="board-layout" role="group" aria-label="Layout">
          <Switch
            size="sm"
            label="Group by Initiative"
            checked={grouped}
            onChange={onGroupedChange}
          />
          {folding && (
            <Button size="sm" variant="ghost" onClick={() => folding.onFoldAll(folding.allFolded)}>
              {folding.allFolded ? "Unfold all" : "Fold all"}
            </Button>
          )}
        </div>
      </div>
      <SavedViewsRow filters={filters} onChange={onChange} />
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  children,
}: {
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <button type="button" className="board-filter-chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The search box keeps what is typed while the address catches up, taking the address's words only
 * when they changed elsewhere (Clear, a Saved view).
 */
function SearchBox({
  query,
  onChange,
}: {
  readonly query: string;
  readonly onChange: (query: string) => void;
}): ReactNode {
  const [typed, setTyped] = useState(query);
  const sent = useRef(query);
  useEffect(() => {
    if (query === (boardFiltersOf({ query: sent.current }).query ?? "")) return;
    sent.current = query;
    setTyped(query);
  }, [query]);
  return (
    <div className="board-filters-search">
      <Input
        type="search"
        size="sm"
        aria-label="Search Tasks"
        placeholder="Search Tasks, Plans and Definitions of Done"
        iconLeft={<Icon name="search" size={14} />}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          sent.current = event.target.value;
          onChange(event.target.value);
        }}
      />
    </div>
  );
}
