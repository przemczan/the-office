import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Idea, Initiative, Task } from "@the-office/contracts";
import {
  ideaQueries,
  initiativeQueries,
  shapeIdea,
  shapeIntoInitiative,
  taskQueries,
} from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import type { IdeaShapeChoice } from "../../shell/work/shape-idea-dialog.tsx";
import { BUG_DESCRIPTION_OUTLINE } from "../../shell/work/work-words.ts";

/**
 * Shapes the Idea into a Task of a Kind (Feature unless chosen) in a Project, given by its id; the
 * Task starts in Backlog. A Bug from an Idea without notes takes the Bug outline as its Description,
 * which the web sends, as the service knows no outline.
 */
export function useShaping(idea: Idea): UseMutationResult<Task, Error, IdeaShapeChoice> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: ({ projectId, kind = "feature" }: IdeaShapeChoice) =>
      shapeIdea(idea.id, {
        projectId,
        kind,
        ...(kind === "bug" && idea.notes.trim() === "" && { description: BUG_DESCRIPTION_OUTLINE }),
      }),
    onSuccess: (task) => showToast(`${task.title} is a Task in Backlog.`),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(ideaQueries.list()),
        queryClient.invalidateQueries(taskQueries.list()),
      ]),
  });
}

/** Shapes the Idea into an Initiative, being shaped, and opens its page. */
export function useShapingIntoInitiative(idea: Idea): UseMutationResult<Initiative, Error, void> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => shapeIntoInitiative(idea.id),
    onSuccess: (initiative) =>
      navigate({ to: "/work/initiatives/$initiativeId", params: { initiativeId: initiative.id } }),
    onError: (error) => showToast(error.message),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(ideaQueries.list()),
        queryClient.invalidateQueries(initiativeQueries.list()),
      ]),
  });
}
