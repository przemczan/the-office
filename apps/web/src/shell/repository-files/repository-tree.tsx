import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RepositoryFolderEntry } from "@the-office/contracts";
import { EmptyState, Icon } from "@the-office/ui";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { projectQueries } from "../../api/projects.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { foldersAbove, leftOutWords, pathIn } from "./repository-files-words.ts";
import "./repository-files.css";

const EVERY_FILE: readonly string[] = [];

export type RepositoryEntryKind = RepositoryFolderEntry["kind"];

interface RepositoryTreeProps {
  readonly projectId: string;
  readonly commit: string;
  /** The tree's accessible name. */
  readonly label: string;
  /** The file or folder selected; "" for none. */
  readonly selected: string;
  readonly onSelect: (path: string, kind: RepositoryEntryKind) => void;
  /** A path whose folders start unfolded, down to it and, when it is a folder, it too. */
  readonly reveal: string;
}

interface TreeState {
  readonly projectId: string;
  readonly commit: string;
  readonly selected: string;
  readonly tabbable: string | null;
  readonly isUnfolded: (path: string) => boolean;
  readonly onPress: (path: string, kind: RepositoryEntryKind) => void;
}

const TreeContext = createContext<TreeState | undefined>(undefined);

function useTree(): TreeState {
  const tree = useContext(TreeContext);
  if (tree === undefined) throw new Error("No RepositoryTree above this item");
  return tree;
}

/**
 * The files of one commit as a tree (the WAI-ARIA treeview pattern): a folder's entries are read
 * only once it is unfolded, one folder a request. ↑ and ↓ move, → unfolds or enters, ← folds or goes
 * up, Enter and Space select a file or fold a folder, Home and End go to the first and last item.
 */
export function RepositoryTree({
  projectId,
  commit,
  label,
  selected,
  onSelect,
  reveal,
}: RepositoryTreeProps): ReactNode {
  const top = useQuery(projectQueries.repositoryFolder(projectId, commit, "", EVERY_FILE));
  // What the user folded or unfolded; every other folder is unfolded only on the way to `reveal`.
  const [folding, setFolding] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [focused, setFocused] = useState<string | null>(reveal === "" ? null : reveal);
  const tree = useRef<HTMLUListElement>(null);
  const moveFocus = useRef(false);

  const revealed = new Set([...foldersAbove(reveal), reveal]);
  const isUnfolded = (path: string): boolean => folding.get(path) ?? revealed.has(path);
  const fold = (path: string, unfolded: boolean): void =>
    setFolding((was) => new Map(was).set(path, unfolded));
  const focus = (path: string): void => {
    moveFocus.current = true;
    setFocused(path);
  };

  // The items shown, in order, from the folders already read; subscribing to those unfolded makes
  // the tree count an item as soon as its folder is read.
  const client = useQueryClient();
  const folderOptions = (path: string) =>
    projectQueries.repositoryFolder(projectId, commit, path, EVERY_FILE);
  const shown: string[] = [];
  const unfoldedShown: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of client.getQueryData(folderOptions(folder).queryKey)?.entries ?? []) {
      const path = pathIn(folder, entry.name);
      shown.push(path);
      if (entry.kind === "folder" && isUnfolded(path)) {
        unfoldedShown.push(path);
        walk(path);
      }
    }
  };
  if (top.data) walk("");
  useQueries({ queries: unfoldedShown.map(folderOptions) });
  // The one item Tab reaches: the focused one, else the selected one, else the first.
  const tabbable =
    [focused, selected].find((path) => path !== null && shown.includes(path)) ?? shown[0] ?? null;

  const items = (): HTMLElement[] => [
    ...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []),
  ];
  useLayoutEffect(() => {
    if (!moveFocus.current || focused === null) return;
    moveFocus.current = false;
    items()
      .find((item) => item.dataset["path"] === focused)
      ?.focus();
  });
  const focusOn = (target: HTMLElement | null | undefined): void => {
    const targetPath = target?.dataset["path"];
    if (targetPath !== undefined) focus(targetPath);
  };

  const onPress = (path: string, kind: RepositoryEntryKind): void => {
    setFocused(path);
    if (kind === "folder") fold(path, !isUnfolded(path));
    onSelect(path, kind);
  };

  // One handler for every row, as a row's press would otherwise reach each folder holding it too.
  const onClick = (event: MouseEvent<HTMLUListElement>): void => {
    const row =
      event.target instanceof Element ? event.target.closest(".repository-tree-row") : null;
    const item = row?.parentElement;
    const path = item?.dataset["path"];
    if (path === undefined) return;
    onPress(path, item?.dataset["kind"] === "folder" ? "folder" : "file");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const itemsShown = items();
    const at = itemsShown.findIndex((item) => item === document.activeElement);
    const item = itemsShown[at];
    if (item === undefined) return;
    const path = item.dataset["path"] ?? "";
    const kind: RepositoryEntryKind = item.dataset["kind"] === "folder" ? "folder" : "file";
    const unfolded = item.getAttribute("aria-expanded") === "true";
    const keys: Readonly<Record<string, () => void>> = {
      ArrowDown: () => focusOn(itemsShown[at + 1]),
      ArrowUp: () => focusOn(itemsShown[at - 1]),
      Home: () => focusOn(itemsShown[0]),
      End: () => focusOn(itemsShown.at(-1)),
      ArrowRight: () => {
        if (kind !== "folder") return;
        if (!unfolded) fold(path, true);
        else focusOn(item.querySelector<HTMLElement>('[role="group"] [role="treeitem"]'));
      },
      ArrowLeft: () => {
        if (kind === "folder" && unfolded) fold(path, false);
        else focusOn(item.parentElement?.closest<HTMLElement>('[role="treeitem"]'));
      },
      Enter: () => onPress(path, kind),
      " ": () => onPress(path, kind),
    };
    const act = keys[event.key];
    if (act === undefined) return;
    event.preventDefault();
    act();
  };

  if (top.error) return <RefusalAlert title="The files can't be read" error={top.error} />;
  if (!top.data) return <p className="repository-tree-quiet">Reading the files…</p>;
  if (top.data.total === 0) {
    return (
      <EmptyState
        compact
        icon="folder"
        title="No files on this branch"
        description="A file shows here once it is committed."
      />
    );
  }
  return (
    <TreeContext value={{ projectId, commit, selected, tabbable, isUnfolded, onPress }}>
      <ul
        ref={tree}
        role="tree"
        aria-label={label}
        className="repository-tree"
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <FolderItems folder="" entries={top.data.entries} total={top.data.total} level={1} />
      </ul>
    </TreeContext>
  );
}

function FolderItems({
  folder,
  entries,
  total,
  level,
}: {
  readonly folder: string;
  readonly entries: readonly RepositoryFolderEntry[];
  readonly total: number;
  readonly level: number;
}): ReactNode {
  const leftOut = leftOutWords({ entries, total });
  return (
    <>
      {entries.map((entry, index) => (
        <TreeItem
          key={entry.name}
          path={pathIn(folder, entry.name)}
          entry={entry}
          level={level}
          position={index + 1}
          count={entries.length}
        />
      ))}
      {leftOut !== null && (
        <li role="none" className="repository-tree-note" style={levelStyle(level)}>
          {leftOut}
        </li>
      )}
    </>
  );
}

function TreeItem({
  path,
  entry,
  level,
  position,
  count,
}: {
  readonly path: string;
  readonly entry: RepositoryFolderEntry;
  readonly level: number;
  readonly position: number;
  readonly count: number;
}): ReactNode {
  const tree = useTree();
  const folder = entry.kind === "folder";
  const unfolded = folder && tree.isUnfolded(path);
  return (
    <li
      role="treeitem"
      className="repository-tree-item"
      data-path={path}
      data-kind={entry.kind}
      aria-level={level}
      aria-posinset={position}
      aria-setsize={count}
      aria-selected={path === tree.selected}
      aria-expanded={folder ? unfolded : undefined}
      tabIndex={path === tree.tabbable ? 0 : -1}
    >
      <div className="repository-tree-row" style={levelStyle(level)}>
        <span className="repository-tree-chevron" aria-hidden="true">
          {folder && <Icon name={unfolded ? "chevron-down" : "chevron-right"} size={14} />}
        </span>
        <Icon name={folder ? (unfolded ? "folder-open" : "folder") : "file"} size={14} />
        <span className="repository-tree-name">{entry.name}</span>
      </div>
      {unfolded && <FolderGroup path={path} level={level + 1} />}
    </li>
  );
}

/** An unfolded folder's entries, read as it unfolds. */
function FolderGroup({
  path,
  level,
}: {
  readonly path: string;
  readonly level: number;
}): ReactNode {
  const tree = useTree();
  const folder = useQuery(
    projectQueries.repositoryFolder(tree.projectId, tree.commit, path, EVERY_FILE),
  );
  return (
    <ul role="group" className="repository-tree-group">
      {folder.error && (
        <li role="none" className="repository-tree-note" style={levelStyle(level)}>
          <RefusalAlert title="This folder can't be read" error={folder.error} />
        </li>
      )}
      {folder.isPending && (
        <li role="none" className="repository-tree-note" style={levelStyle(level)}>
          Reading the folder…
        </li>
      )}
      {folder.data && folder.data.total === 0 && (
        <li role="none" className="repository-tree-note" style={levelStyle(level)}>
          Empty folder
        </li>
      )}
      {folder.data && (
        <FolderItems
          folder={path}
          entries={folder.data.entries}
          total={folder.data.total}
          level={level}
        />
      )}
    </ul>
  );
}

/** Each level is indented by the tree's own step, in its CSS. */
function levelStyle(level: number): CSSProperties {
  return { "--tree-level": level } as CSSProperties;
}
