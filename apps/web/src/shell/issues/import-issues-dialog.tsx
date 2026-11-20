import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { OFFICE_IDENTITY_SETTINGS_PATH, type OpenIssue, type Project } from "@the-office/contracts";
import { Button, Checkbox, Dialog, EmptyState, GroupedSelect, Icon, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { importIssues, OPEN_ISSUES, projectQueries } from "../../api/projects.ts";
import { BlockLoader } from "../block-loader.tsx";
import { GitHubPermissionsPrompt } from "../github-permissions-prompt.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { useClock } from "../use-clock.ts";
import { KindGlyph } from "../work/task-state-badge.tsx";
import { KIND_NAMES } from "../work/work-words.ts";
import {
  MOST_LISTED,
  MOST_PICKED,
  PICKED_ENOUGH,
  SIGN_IN_TO_IMPORT,
  importWords,
  importedWords,
  issuesMatching,
  issuesPageOf,
  issuesRefusalOf,
  notImportedWords,
  openedWords,
  repositoryOfIssue,
} from "./issue-words.ts";
import "./import-issues.css";

/**
 * Import issues (docs/design/issues-as-tasks.html): a Project's open GitHub issues not yet
 * imported, newest first, searched in place; the ones picked, at most 50, each become a Task in
 * Backlog with the Kind its row previews. With several `projects`, a picker at the top changes the
 * Project, starting on `projectId`.
 */
export function ImportIssuesDialog({
  projects,
  projectId: startingProjectId,
  onClose,
}: {
  /** The Projects it may import into, each on GitHub; the picker shows while there is more than one. */
  readonly projects: readonly Project[];
  readonly projectId: string;
  readonly onClose: () => void;
}): ReactNode {
  const [projectId, setProjectId] = useState(startingProjectId);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const issues = useQuery(projectQueries.openIssues(projectId));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const importing = useMutation({
    mutationFn: () => importIssues(projectId, [...picked]),
    onSuccess: async (result) => {
      showToast(importedWords(result));
      onClose();
      await queryClient.invalidateQueries({ queryKey: OPEN_ISSUES });
    },
  });
  const whyNotImport = picked.size === 0 ? "Pick the issues to import first." : undefined;
  return (
    <Dialog
      size="medium"
      keepsHeight
      title="Import issues"
      unsavedChanges={picked.size > 0}
      onClose={onClose}
      actions={
        <>
          <Button
            loading={importing.isPending}
            disabled={whyNotImport !== undefined}
            title={whyNotImport}
            onClick={() => importing.mutate()}
          >
            {importWords(picked.size)}
          </Button>
          <span className="dialog-hint">Each becomes a Task in Backlog with Normal priority.</span>
        </>
      }
    >
      <div className="import-issues">
        <div className="import-issues-top">
          {projects.length > 1 && (
            <div className="import-issues-project">
              <GroupedSelect
                label="Project"
                labelHidden
                size="sm"
                value={projectId}
                groups={[
                  {
                    label: "Projects",
                    options: projects.map(({ id, name }) => ({ value: id, label: name })),
                  },
                ]}
                onChange={(id) => {
                  setProjectId(id);
                  setPicked(new Set());
                }}
              />
            </div>
          )}
          <Input
            type="search"
            size="sm"
            aria-label="Search the issues"
            placeholder="Search by title, number, label or author"
            iconLeft={<Icon name="search" size={14} />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {importing.error && (
          <RefusalAlert title="The issues weren't imported" error={importing.error} />
        )}
        <GitHubPermissionsPrompt needing="issues" />
        <IssueList
          issues={issues.data}
          error={issues.error}
          search={search}
          picked={picked}
          onPick={setPicked}
        />
      </div>
    </Dialog>
  );
}

function IssueList({
  issues,
  error,
  search,
  picked,
  onPick,
}: {
  readonly issues: readonly OpenIssue[] | undefined;
  readonly error: Error | null;
  readonly search: string;
  readonly picked: ReadonlySet<number>;
  readonly onPick: (picked: ReadonlySet<number>) => void;
}): ReactNode {
  const now = useClock();
  if (error) return <IssuesRefused error={error} />;
  if (issues === undefined) {
    return (
      <div className="import-issues-list">
        <BlockLoader shape="rows" label="Loading the open issues…" />
      </div>
    );
  }
  if (issues.length === 0) {
    return (
      <div className="import-issues-list">
        <EmptyState
          icon="circle-dot"
          title="No open issue is left to import."
          description="Every open issue is already imported, or the repository has none. An issue opened on GitHub shows here."
        />
      </div>
    );
  }
  const shown = issuesMatching(issues, search);
  const repository = repositoryOfIssue(issues[0]?.url ?? "");
  const olderOnes = issues.length >= MOST_LISTED ? issuesPageOf(issues[0]?.url ?? "") : undefined;
  const pickedShown = shown.filter(({ number }) => picked.has(number)).length;
  const full = picked.size >= MOST_PICKED;
  const toggle = (number: number): void => {
    const next = new Set(picked);
    if (next.has(number)) next.delete(number);
    else if (!full) next.add(number);
    onPick(next);
  };
  const pickAll = (on: boolean): void => {
    const next = new Set(picked);
    for (const { number } of shown) {
      if (!on) next.delete(number);
      else if (next.size < MOST_PICKED) next.add(number);
    }
    onPick(next);
  };
  return (
    <section className="import-issues-list" aria-label="Open issues">
      <header className="import-issues-head">
        <span role="group" aria-label="Pick every issue shown" className="import-issues-check">
          <Checkbox
            checked={shown.length > 0 && pickedShown === shown.length}
            indeterminate={pickedShown > 0 && pickedShown < shown.length}
            disabled={shown.length === 0}
            onChange={() => pickAll(pickedShown === 0)}
          />
        </span>
        <span className="import-issues-count">
          {notImportedWords(issues.length)}
          {picked.size > 0 && (
            <>
              {" · "}
              <strong>{picked.size} picked</strong>
            </>
          )}
        </span>
        {repository && <span className="import-issues-repository">{repository}</span>}
      </header>
      {shown.length === 0 ? (
        <p className="import-issues-none">No open issue matches “{search.trim()}”.</p>
      ) : (
        <ul className="import-issues-rows">
          {shown.map((issue) => (
            <IssueRow
              key={issue.number}
              issue={issue}
              now={now}
              picked={picked.has(issue.number)}
              disabledWhy={full && !picked.has(issue.number) ? PICKED_ENOUGH : undefined}
              onToggle={() => toggle(issue.number)}
            />
          ))}
          {olderOnes && (
            <li className="import-issues-older">
              Showing the newest {MOST_LISTED}.{" "}
              <a href={olderOnes} target="_blank" rel="noreferrer">
                Search on GitHub for older ones.
              </a>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** One issue, one press target: pressing anywhere on it toggles its Checkbox. */
function IssueRow({
  issue,
  now,
  picked,
  disabledWhy,
  onToggle,
}: {
  readonly issue: OpenIssue;
  readonly now: Date;
  readonly picked: boolean;
  readonly disabledWhy: string | undefined;
  readonly onToggle: () => void;
}): ReactNode {
  const disabled = disabledWhy !== undefined;
  return (
    // The Checkbox inside is the keyboard's stop; a press elsewhere on the row is the pointer's.
    <li
      role="group"
      aria-label={`#${issue.number} ${issue.title}`}
      className={`import-issue${picked ? " picked" : ""}${disabled ? " disabled" : ""}`}
      title={disabledWhy}
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <Checkbox checked={picked} disabled={disabled} onChange={onToggle} />
      <span className="import-issue-number">#{issue.number}</span>
      <span className="import-issue-words">
        <span className="import-issue-title">{issue.title}</span>
        <span className="import-issue-line">
          {issue.labels.map((label) => (
            <span
              key={label}
              className={`import-issue-label${label.toLowerCase() === "bug" ? " bug" : ""}`}
            >
              {label}
            </span>
          ))}
          <span>
            {issue.labels.length > 0 && "· "}
            {openedWords(issue, now)}
          </span>
        </span>
      </span>
      <span className={`import-issue-kind kind-${issue.kind}`} title="The Kind its Task gets">
        <KindGlyph kind={issue.kind} size={13} />
        {KIND_NAMES[issue.kind]}
      </span>
    </li>
  );
}

/** Why the issues can't be listed: sign in first, a repository not on GitHub, or a failure. */
export function IssuesRefused({ error }: { readonly error: Error }): ReactNode {
  const refusal = issuesRefusalOf(error);
  switch (refusal.kind) {
    case "sign-in":
      return (
        <div className="import-issues-list">
          <EmptyState
            icon="github"
            title={SIGN_IN_TO_IMPORT}
            action={
              <Link className="link-button" to={OFFICE_IDENTITY_SETTINGS_PATH}>
                Open Settings › Office identity
              </Link>
            }
          />
        </div>
      );
    case "not-on-github":
      return (
        <div className="import-issues-list">
          <EmptyState icon="circle-dot" title={refusal.words} />
        </div>
      );
    case "failed":
      return <RefusalAlert title="The open issues can't be read" error={refusal.error} />;
  }
}
