import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Stage } from "@the-office/contracts";
import { addStageTemplate, stageTemplateQueries } from "../../api/pipelines.ts";
import { useToast } from "../toasts.tsx";
import { STAGE_KIND_NAMES, withoutFailureRule } from "./stage-edits.ts";

/**
 * Save as template: the Stage added to the templates as it is, without its failure rule or its
 * place and routes, which only a Pipeline gives meaning.
 */
export function useSaveAsTemplate() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (stage: Stage) => addStageTemplate(asTemplateStage(stage)),
    onSuccess: async ({ stage }) => {
      await queryClient.invalidateQueries(stageTemplateQueries.list());
      showToast(`${shownName(stage)} saved as a Stage template.`);
    },
  });
}

function asTemplateStage(stage: Stage): Stage {
  const { routes: _routes, place: _place, ...rest } = withoutFailureRule(stage);
  return rest;
}

/** A Stage's name, or its kind's while it has none. */
export function shownName(stage: Stage): string {
  return stage.name.trim() || STAGE_KIND_NAMES[stage.kind];
}
