import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LinkedStage, RefusedPipeline, Stage } from "@the-office/contracts";
import { Alert, Badge, Button, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { applyStageTemplateEdit, refreshPipelineList } from "../../api/pipelines.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import {
  differenceWords,
  fieldsChanged,
  fieldsDiffering,
  linkedPipelineWords,
  replacedWords,
  stageCount,
  templateFieldWords,
} from "./template-link.ts";
import "./stage-form.css";

/** What the dialog edits: the template as it was and as the edit makes it. */
export interface TemplateEdit {
  readonly templateId: string;
  readonly before: Stage;
  readonly after: Stage;
}

/**
 * "Apply the edit to linked Stages" (docs/spec/screens/settings.md, Pipelines): each linked Stage
 * with how it differs from the template as it was, the Stages that don't differ in a field the
 * edit changes ticked to begin with. With `save`, the template isn't saved yet: Save and apply,
 * Save the template only, Cancel. Without, it is (a Proposal applied): Apply, or leave them. Each
 * Pipeline the service refuses is named with why once the rest are applied.
 */
export function ApplyTemplateEditDialog({
  edit,
  linked,
  save,
  onClose,
}: {
  readonly edit: TemplateEdit;
  readonly linked: readonly LinkedStage[];
  /** Saves the template, before the edit is applied; undefined when it is saved already. */
  readonly save?: () => Promise<void>;
  readonly onClose: () => void;
}): ReactNode {
  // As it opened: saving the template moves `edit.before` on, and the dialog stays to name refusals.
  const [{ templateId, before, after }] = useState(edit);
  const changed = fieldsChanged(before, after);
  const rows = linked.map((each) => linkedRow(each, before, changed));
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(rows.filter(({ replaced }) => replaced.length === 0).map(({ id }) => id)),
  );
  const [refused, setRefused] = useState<readonly RefusedPipeline[]>([]);
  const projects = useQuery(projectQueries.list()).data;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const name = after.name;
  const chosen = rows.filter(({ id }) => ticked.has(id));
  const applying = useMutation({
    mutationFn: async (apply: boolean) => {
      await save?.();
      if (!apply || chosen.length === 0) return undefined;
      return applyStageTemplateEdit(
        templateId,
        changed,
        chosen.map(({ linked: { pipelineId, stage } }) => ({ pipelineId, stageKey: stage.key })),
      );
    },
    onSuccess: async (result) => {
      await refreshPipelineList(queryClient);
      const toast = appliedToast(name, save !== undefined, result?.applied);
      if (toast !== undefined) showToast(toast);
      if (result && result.refused.length > 0) setRefused(result.refused);
      else onClose();
    },
  });
  const projectNamed = (id: string): string | undefined =>
    projects?.find((project) => project.id === id)?.name;
  const pipelineWords = ({ pipelineName, projectId }: LinkedStage): string =>
    linkedPipelineWords(
      pipelineName,
      projectId === null ? null : { id: projectId, name: projectNamed(projectId) },
    );
  const toggle = (id: string): void =>
    setTicked((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const done = refused.length > 0;
  return (
    <Dialog
      size="large"
      title="Apply the edit to linked Stages"
      onClose={onClose}
      actions={
        done ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" disabled={applying.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              disabled={applying.isPending}
              onClick={() => applying.mutate(false)}
            >
              {save ? "Save the template only" : "Leave them as they are"}
            </Button>
            <Button
              loading={applying.isPending}
              disabled={chosen.length === 0}
              onClick={() => applying.mutate(true)}
            >
              {`${save ? "Save and apply" : "Apply"} to ${stageCount(chosen.length)}`}
            </Button>
          </>
        )
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">This edit changes {templateFieldWords(changed)}.</p>
        <table className="apply-template-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Apply</span>
              </th>
              <th scope="col">Pipeline</th>
              <th scope="col">Stage</th>
              <th scope="col">How it differs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Apply to ${row.linked.stage.name} in ${pipelineWords(row.linked)}`}
                    checked={ticked.has(row.id)}
                    disabled={applying.isPending || done}
                    onChange={() => toggle(row.id)}
                  />
                </td>
                <td>{pipelineWords(row.linked)}</td>
                <td>{row.linked.stage.name}</td>
                <td>
                  {differenceWords(row.differing)}
                  {row.replaced.length > 0 && (
                    <>
                      {" "}
                      <Badge tone="warning">{replacedWords(row.replaced)}</Badge>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {done && (
          <Alert tone="warning" title="Some Pipelines kept their Stages as they were">
            <ul className="apply-template-refused">
              {refused.map((pipeline) => (
                <li key={pipeline.pipelineId}>
                  <strong>
                    {linkedPipelineWords(
                      pipeline.pipelineName,
                      pipeline.projectId === null
                        ? null
                        : { id: pipeline.projectId, name: projectNamed(pipeline.projectId) },
                    )}
                  </strong>
                  : {pipeline.reasons.join(" ")}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {applying.error && (
          <RefusalAlert
            title={save ? `${name} wasn't saved` : "The edit wasn't applied"}
            error={applying.error}
          />
        )}
      </div>
    </Dialog>
  );
}

interface LinkedRow {
  readonly id: string;
  readonly linked: LinkedStage;
  /** How it differs from the template as it was before the edit. */
  readonly differing: readonly string[];
  /** The fields it had its own of that the edit replaces. */
  readonly replaced: readonly string[];
}

function linkedRow(linked: LinkedStage, before: Stage, changed: readonly string[]): LinkedRow {
  const differing = fieldsDiffering(linked.stage, before);
  return {
    id: `${linked.pipelineId}/${linked.stage.key}`,
    linked,
    differing,
    replaced: differing.filter((field) => changed.includes(field)),
  };
}

/** Undefined when nothing changed: no Stage applied to, and the template saved already. */
function appliedToast(
  name: string,
  saved: boolean,
  applied: number | undefined,
): string | undefined {
  if (applied === undefined) {
    return saved ? `${name} saved. Its linked Stages keep their fields.` : undefined;
  }
  return saved
    ? `${name} saved and applied to ${stageCount(applied)}.`
    : `${name}'s edit applied to ${stageCount(applied)}.`;
}
