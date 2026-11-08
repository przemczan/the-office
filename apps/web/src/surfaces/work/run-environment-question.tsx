import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectRunEnvironment } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeRunEnvironment, projectQueries, setUpRunEnvironment } from "../../api/projects.ts";
import {
  RUN_ENVIRONMENT_ANSWER_LABELS,
  RUN_ENVIRONMENT_QUESTION,
  setUpWords,
  settingChosenWords,
} from "../../shell/run-environment-words.ts";
import { useToast } from "../../shell/toasts.tsx";

type StartAnswer = "yes" | "no";

/**
 * The Project whose Run environment Start asks about: one "Not decided yet" with no set-up Task
 * open, as Yes already gave it one. Read only while `asking`, so a Task that can't start reads none.
 */
export function useAskedProject(projectId: string, asking: boolean): Project | undefined {
  const project = useQuery({ ...projectQueries.one(projectId), enabled: asking }).data;
  const undecided = asking && project?.runEnvironment === "not-decided";
  const runEnvironment = useQuery({
    ...projectQueries.runEnvironment(projectId),
    enabled: undecided,
  }).data;
  const asked =
    undecided && runEnvironment?.runEnvironment === "not-decided" && !runEnvironment.setUpTask;
  return asked ? project : undefined;
}

/**
 * The run environment question beside Start, which never waits for it: Yes acts as Set up run
 * environment, No sets Off, and the Project's event takes the line away.
 */
export function RunEnvironmentQuestion({ project }: { readonly project: Project }): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const answering = useMutation({
    mutationFn: (answer: StartAnswer) =>
      answer === "yes" ? setUpRunEnvironment(project.id) : changeRunEnvironment(project.id, "off"),
    onSuccess: (saved: ProjectRunEnvironment, answer) => {
      queryClient.setQueryData(projectQueries.runEnvironment(project.id).queryKey, saved);
      void queryClient.invalidateQueries({ queryKey: projectQueries.one(project.id).queryKey });
      showToast(
        answer === "yes"
          ? setUpWords(saved, project.name)
          : settingChosenWords(saved, project.name),
      );
    },
    onError: (error) => showToast(error.message),
  });
  const answerButton = (answer: StartAnswer): ReactNode => (
    <Button
      variant="secondary"
      size="sm"
      disabled={answering.isPending}
      loading={answering.isPending && answering.variables === answer}
      onClick={() => answering.mutate(answer)}
    >
      {RUN_ENVIRONMENT_ANSWER_LABELS[answer]}
    </Button>
  );
  return (
    <div className="task-head-note task-head-question" role="group" aria-label="Run environment">
      <Icon name="container" size={14} />
      <span>{RUN_ENVIRONMENT_QUESTION}</span>
      <span className="task-head-question-answers">
        {answerButton("yes")}
        {answerButton("no")}
      </span>
    </div>
  );
}
