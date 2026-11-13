import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Project } from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { searchQuery } from "../../api/work.ts";
import { MENTION_KINDS } from "../mentions/mention-words.ts";
import { ProjectMark } from "../project-mark.tsx";
import { InOtherProjectsNote } from "../project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../project-filter/use-project-filter.ts";
import { useClosedFromOutside } from "../use-closed-from-outside.ts";
import {
  matchesInOtherProjects,
  peopleMatching,
  searchGroups,
  searchWords,
  type SearchGroup,
  type SearchPick,
} from "./search-options.ts";
import "./top-bar-search.css";

const KIND_ICONS: Readonly<Record<SearchPick["kind"], string>> = {
  task: MENTION_KINDS.task.icon,
  initiative: MENTION_KINDS.initiative.icon,
  idea: MENTION_KINDS.idea.icon,
  person: "user",
  document: "file-text",
};

const SHORTCUT = /mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

/**
 * The top bar's search (spec §2.1): Tasks, Initiatives, Ideas, people and documents by their text,
 * and records by their ID or a pasted link, in the Projects the Project filter shows. ⌘K or Ctrl+K
 * focuses it; the arrows choose, Enter opens. A document opens over the page, so the top bar holds
 * it once the search closes.
 */
export function TopBarSearch({
  onOpenDocument,
}: {
  readonly onOpenDocument: (document: { readonly id: string; readonly name: string }) => void;
}): ReactNode {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(0);
  const box = useClosedFromOutside(open, setOpen);
  const field = useRef<HTMLInputElement>(null);
  useFocusedByShortcut(field, setOpen);
  const navigate = useNavigate();
  const { filter } = useProjectFilter();
  const words = searchWords(query);
  const searching = open && words.length > 0;
  const results = useQuery({
    ...searchQuery(query, filter),
    enabled: searching,
    placeholderData: keepPreviousData,
  });
  const roles = useQuery(roleQueries.list());
  const groups = searchGroups(results.data, peopleMatching(roles.data ?? [], words));
  const options = groups.flatMap((group) => group.options);
  const listId = useId();
  const optionId = (index: number): string => `${listId}-${index}`;

  const openPick = (pick: SearchPick): void => {
    setOpen(false);
    setQuery("");
    field.current?.blur();
    switch (pick.kind) {
      case "task":
        void navigate({ to: "/tasks/$taskId", params: { taskId: pick.taskId } });
        return;
      case "initiative":
        void navigate({
          to: "/work/initiatives/$initiativeId",
          params: { initiativeId: pick.initiativeId },
        });
        return;
      case "idea":
        void navigate({ to: "/work/ideas", search: { idea: pick.ideaId } });
        return;
      case "person":
        void navigate({ to: "/people/$roleKey", params: { roleKey: pick.roleKey } });
        return;
      case "document":
        onOpenDocument({ id: pick.id, name: pick.name });
        return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setChosen((options.length + Math.min(chosen, options.length - 1) + step) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[Math.min(chosen, options.length - 1)];
      if (option) openPick(option.pick);
    }
  };

  const shownChoice = Math.min(chosen, options.length - 1);
  const expanded = searching && (results.data !== undefined || options.length > 0);
  return (
    <div className="top-search" ref={box}>
      <Icon name="search" size={14} />
      <input
        ref={field}
        type="search"
        className="top-search-field"
        placeholder="Find a Task, person, Idea…"
        aria-label="Search The Office"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && options.length > 0 ? optionId(shownChoice) : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setChosen(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd className="top-search-shortcut">{SHORTCUT}</kbd>
      {expanded && (
        <div className="top-search-results">
          {options.length === 0 && <p className="top-search-none">Nothing matches “{query}”.</p>}
          <div id={listId} role="listbox" aria-label="Found">
            {groups.map((group) => (
              <FoundGroup
                key={group.kind}
                group={group}
                firstIndex={options.findIndex(({ key }) => key === group.options[0]?.key)}
                chosen={shownChoice}
                optionId={optionId}
                onPick={openPick}
              />
            ))}
          </div>
          <InOtherProjectsNote
            count={matchesInOtherProjects(results.data)}
            one="match"
            many="matches"
          />
        </div>
      )}
    </div>
  );
}

function FoundGroup({
  group,
  firstIndex,
  chosen,
  optionId,
  onPick,
}: {
  readonly group: SearchGroup;
  /** Where the group's first option is among every option, for the arrows' choice. */
  readonly firstIndex: number;
  readonly chosen: number;
  readonly optionId: (index: number) => string;
  readonly onPick: (pick: SearchPick) => void;
}): ReactNode {
  const projects = useQuery(projectQueries.list());
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId}>
      <p className="top-search-heading" id={headingId}>
        {group.heading}
      </p>
      {group.options.map((option, at) => {
        const index = firstIndex + at;
        return (
          <div
            key={option.key}
            id={optionId(index)}
            role="option"
            aria-selected={index === chosen}
            className={`top-search-option${index === chosen ? " on" : ""}`}
            // mousedown, not click: the field keeps its focus until the pick opens.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(option.pick);
            }}
          >
            <Icon name={KIND_ICONS[option.pick.kind]} size={14} />
            <span className="top-search-label">{option.label}</span>
            {option.mark && <Badge size="sm">{option.mark}</Badge>}
            <ProjectMarks projectIds={option.projectIds} projects={projects.data} />
          </div>
        );
      })}
    </div>
  );
}

function ProjectMarks({
  projectIds,
  projects,
}: {
  readonly projectIds: readonly string[];
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const marked = projects?.filter(({ id }) => projectIds.includes(id)) ?? [];
  return (
    <span className="top-search-marks">
      {marked.map((project) => (
        <ProjectMark key={project.id} project={project} />
      ))}
    </span>
  );
}

/** Focuses the field and opens the search on ⌘K, or Ctrl+K, from anywhere in the app. */
function useFocusedByShortcut(
  field: RefObject<HTMLInputElement | null>,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      field.current?.focus();
      field.current?.select();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [field, setOpen]);
}
