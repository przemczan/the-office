import { useQuery } from "@tanstack/react-query";
import type { BadgeProps } from "@the-office/ui";
import type {
  ChangedFile,
  Task,
  TaskChanges,
  TestResult,
  TestResultState,
} from "@the-office/contracts";
import { Badge, Button, FoldButton, Icon } from "@the-office/ui";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { UnifiedDiffView } from "../../shell/unified-diff-view.tsx";
import { diffsOfFiles, editorLink, fileLineWords, TEST_RESULT_WORDS } from "./changes-words.ts";
import { RecordBlock } from "./record-block.tsx";
import { firstLine } from "./stage-words.ts";

const TEST_RESULT_TONES: Readonly<Record<TestResultState, NonNullable<BadgeProps["tone"]>>> = {
  passed: "success",
  failed: "danger",
  skipped: "neutral",
  "not-run": "neutral",
};

/** The Task's Changes tab: what its commits changed, read as it opens and after each Stage. */
export function ChangesTab({ task }: { readonly task: Task }): ReactNode {
  const changes = useQuery(projectQueries.taskChanges(task.projectId, task.id));
  const stages = useQuery(pipelineQueries.taskStages(task.id));
  if (changes.error) {
    return (
      <RecordBlock icon="git-compare" title="Files changed">
        <p className="task-quiet">The changes can't be read: {changes.error.message}</p>
      </RecordBlock>
    );
  }
  if (!changes.data) return null;
  return <ChangesView changes={changes.data} testResults={stages.data?.testResults ?? []} />;
}

/**
 * The files a Task changed with their lines, each folded to its header until a click shows its diff
 * against the base branch, and the latest test results (prototypes/app/task.js, `changesHtml`); a
 * Gate shows the same.
 */
export function ChangesView({
  changes,
  testResults,
}: {
  readonly changes: TaskChanges;
  readonly testResults: readonly TestResult[];
}): ReactNode {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const diffs = useMemo(() => diffsOfFiles(changes.diff, changes.files), [changes]);
  const toggle = useCallback(
    (path: string) => setUnfolded((previous) => toggled(previous, path)),
    [],
  );
  if (changes.files.length === 0) {
    return (
      <RecordBlock icon="git-compare" title="Files changed">
        <p className="task-quiet">No changes yet.</p>
      </RecordBlock>
    );
  }
  return (
    <RecordBlock
      icon="git-compare"
      title={`Files changed · ${changes.files.length}`}
      actions={
        <span className="changes-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUnfolded(new Set(changes.files.map(({ path }) => path)))}
          >
            Unfold all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setUnfolded(new Set())}>
            Fold all
          </Button>
          {changes.worktreePath !== null && (
            <a className="changes-open" href={editorLink(changes.worktreePath)}>
              Open in editor
            </a>
          )}
        </span>
      }
    >
      <ul className="changes-files">
        {changes.files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            diff={diffs.get(file.path)}
            worktreePath={changes.worktreePath}
            unfolded={unfolded.has(file.path)}
            onToggle={toggle}
          />
        ))}
      </ul>
      {changes.diffCut && (
        <p className="task-quiet changes-cut">The diff stops here: the rest is too long to show.</p>
      )}
      <TestResults results={testResults} />
    </RecordBlock>
  );
}

/**
 * A file of the list: its header unfolds its diff, and it opens in the editor while the Task has its
 * worktree and the file. Memoised, so folding one file re-renders only its row.
 */
const FileRow = memo(function FileRow({
  file,
  diff,
  worktreePath,
  unfolded,
  onToggle,
}: {
  readonly file: ChangedFile;
  /** Its part of the diff; undefined when the diff stops before it. */
  readonly diff: string | undefined;
  readonly worktreePath: string | null;
  readonly unfolded: boolean;
  readonly onToggle: (path: string) => void;
}): ReactNode {
  const lines = fileLineWords(file);
  return (
    <li>
      <div className="changes-file-head">
        <FoldButton
          className="changes-fold"
          unfolded={unfolded}
          onClick={() => onToggle(file.path)}
        >
          <span className="changes-path">
            {file.previousPath !== null && `${file.previousPath} → `}
            {file.path}
            {file.deleted && <span className="task-quiet"> · deleted</span>}
          </span>
          {lines === "binary" ? (
            <span className="task-quiet">binary</span>
          ) : (
            <>
              <span className="changes-added">{lines.added}</span>
              <span className="changes-removed">{lines.removed}</span>
            </>
          )}
        </FoldButton>
        {worktreePath !== null && !file.deleted && (
          <a
            className="changes-open-file"
            href={editorLink(worktreePath, file.path)}
            aria-label={`Open ${file.path} in the editor`}
            title="Open in the editor"
          >
            <Icon name="external-link" size={13} />
          </a>
        )}
      </div>
      {unfolded && (
        <div className="changes-diff">
          {diff === undefined ? (
            <p className="task-quiet">
              The diff stops before this file: the rest is too long to show.
            </p>
          ) : (
            <UnifiedDiffView diff={diff} label={`Diff of ${file.path} against the base branch`} />
          )}
        </div>
      )}
    </li>
  );
});

function toggled(paths: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(paths);
  if (!next.delete(path)) next.add(path);
  return next;
}

function TestResults({ results }: { readonly results: readonly TestResult[] }): ReactNode {
  return (
    <div className="changes-tests">
      <span className="task-quiet">Tests:</span>
      {results.length === 0 ? (
        <Badge tone="neutral">{TEST_RESULT_WORDS["not-run"]}</Badge>
      ) : (
        results.map((result) => (
          <span
            key={result.stageKey}
            title={result.detail === null ? undefined : firstLine(result.detail)}
          >
            <Badge tone={TEST_RESULT_TONES[result.state]}>
              {result.name} {TEST_RESULT_WORDS[result.state]}
            </Badge>
          </span>
        ))
      )}
    </div>
  );
}
