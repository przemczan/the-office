import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import {
  pipelineEditSchema,
  stageTemplateEditSchema,
  type PipelineEdit,
  type Proposal,
  type Stage,
} from "@the-office/contracts";
import { proposalQueries } from "../../../api/conversations.ts";

/**
 * A Proposal of a library Pipeline or Stage template action, opened by "Edit before applying" in
 * its editor, filled with the call's input; saving there applies the Proposal with the edited input.
 * `recordId` is the Pipeline or template a change saves, undefined for one that adds.
 */
export type ProposedLibraryEdit =
  | {
      readonly kind: "pipeline";
      readonly proposal: Proposal;
      readonly recordId: string | undefined;
      readonly edit: PipelineEdit;
    }
  | {
      readonly kind: "stage-template";
      readonly proposal: Proposal;
      readonly recordId: string | undefined;
      readonly edit: Stage;
    };

/**
 * The open Proposal the address's `?proposal=` names, when it is of a library Pipeline or Stage
 * template action whose input reads; undefined otherwise, so the editors open as usual.
 */
export function useProposedLibraryEdit(): ProposedLibraryEdit | undefined {
  const { proposal: id } = useSearch({ strict: false });
  const read = useQuery({ ...proposalQueries.one(id ?? ""), enabled: id !== undefined });
  return read.data && proposedLibraryEditOf(read.data);
}

function proposedLibraryEditOf(proposal: Proposal): ProposedLibraryEdit | undefined {
  const { change, status } = proposal;
  if (status.kind !== "open" || change.kind !== "office-action" || !change.editableInput) {
    return undefined;
  }
  const { pipelineId, templateId, ...rest } = change.editableInput;
  switch (change.action) {
    case "add_library_pipeline":
    case "change_library_pipeline": {
      const edit = pipelineEditSchema.safeParse(rest);
      return edit.success
        ? { kind: "pipeline", proposal, recordId: textOf(pipelineId), edit: edit.data }
        : undefined;
    }
    case "add_stage_template":
    case "change_stage_template": {
      const edit = stageTemplateEditSchema.safeParse(rest);
      return edit.success
        ? { kind: "stage-template", proposal, recordId: textOf(templateId), edit: edit.data.stage }
        : undefined;
    }
    default:
      return undefined;
  }
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
