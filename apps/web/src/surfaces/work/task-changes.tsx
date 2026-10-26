import { useQuery } from "@tanstack/react-query";
import type { BadgeProps } from "@the-office/ui";
import type { ChangedFile, Task, TaskChanges } from "@the-office/contracts";
import { Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import {
  diffLines,
  editorLink,
  fileLineWords,
  latestTestResults,
  TEST_RESULT_WORDS,
  type TestResult,
  type TestResultState,
} from "./changes-words.ts";
import { RecordBlock } from "./record-block.tsx";

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
  return (
    <ChangesView
      changes={changes.data}
      testResults={latestTestResults(stages.data?.stages ?? [])}
    />
  );
}

/**
 * The files a Task changed with their lines, the diff against the base branch and the latest test
 * results (prototypes/app/task.js, `changesHtml`); a Gate shows the same.
 */
export function ChangesView({
  changes,
  testResults,
}: {
  readonly changes: TaskChanges;
  readonly testResults: readonly TestResult[];
}): ReactNode {
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
        changes.worktreePath !== null && (
          <a className="changes-open" href={editorLink(changes.worktreePath)}>
            Open in editor
          </a>
        )
      }
    >
      <ul className="changes-files">
        {changes.files.map((file) => (
          <FileRow key={file.path} file={file} worktreePath={changes.worktreePath} />
        ))}
      </ul>
      <Diff diff={changes.diff} />
      {changes.diffCut && (
        <p className="task-quiet changes-cut">The diff stops here: the rest is too long to show.</p>
      )}
      <TestResults results={testResults} />
    </RecordBlock>
  );
}

/** A file of the list, which opens in the editor while the Task has its worktree and the file. */
function FileRow({
  file,
  worktreePath,
}: {
  readonly file: ChangedFile;
  readonly worktreePath: string | null;
}): ReactNode {
  const lines = fileLineWords(file);
  return (
    <li>
      <span className="changes-path">
        {file.previousPath !== null && `${file.previousPath} → `}
        {worktreePath === null || file.deleted ? (
          file.path
        ) : (
          <a href={editorLink(worktreePath, file.path)}>{file.path}</a>
        )}
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
    </li>
  );
}

function Diff({ diff }: { readonly diff: string }): ReactNode {
  const lines = diffLines(diff);
  if (lines.length === 0) return null;
  return (
    <pre className="changes-diff" aria-label="Diff against the base branch">
      {lines.map((line, index) => (
        // A diff's lines repeat and never move, so their place is their identity.
        <span key={index} className={`changes-diff-${line.kind}`}>
          {line.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function TestResults({ results }: { readonly results: readonly TestResult[] }): ReactNode {
  return (
    <div className="changes-tests">
      <span className="task-quiet">Tests:</span>
      {results.length === 0 ? (
        <Badge tone="neutral">{TEST_RESULT_WORDS["not-run"]}</Badge>
      ) : (
        results.map((result) => (
          <span key={result.stageKey} title={result.detail}>
            <Badge tone={TEST_RESULT_TONES[result.state]}>
              {result.name} {TEST_RESULT_WORDS[result.state]}
            </Badge>
          </span>
        ))
      )}
    </div>
  );
}
