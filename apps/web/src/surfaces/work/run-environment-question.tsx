import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  OffBoardTask,
  OffBoardTaskStart,
  Project,
  ProjectRunEnvironment,
  RunEnvironmentSetUpAnswer,
} from "@the-office/contracts";
import { Alert, Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeRunEnvironment, projectQueries, setUpRunEnvironment } from "../../api/projects.ts";
import {
  RUN_ENVIRONMENT_ANSWER_LABELS,
  RUN_ENVIRONMENT_QUESTION,
  setUpWords,
  settingChosenWords,
} from "../../shell/run-environment-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import {
  FOLLOW_IT_ON,
  runEnvironmentLinkWords,
  SET_UP_REFUSED,
  setUpHintWords,
  settingUpWords,
  TURNS_ON_WHEN_DONE,
} from "./off-board-task-words.ts";

type StartAnswer = "yes" | "no";

/**
 * Where this browser keeps the start Yes answered, per Project, so the line after Yes outlives the
 * question it replaces; never read from the service.
 */
function setUpStartKey(projectId: string) {
  return ["run-environment-set-up-start", projectId] as const;
}

/** What the head shows of a Project's Run environment beside Start. */
export type AskedRunEnvironment =
  | { readonly kind: "question"; readonly project: Project }
  | { readonly kind: "setting-up"; readonly project: Project; readonly offBoardTask: OffBoardTask };

/**
 * The Project's Run environment as Start's notes show it: the question while it is "Not decided
 * yet" with no set-up Task open; after Yes here, who is setting it up, until it is decided. Read
 * only while `asking`, so a Task that can't start reads none.
 */
export function useAskedProject(
  projectId: string,
  asking: boolean,
): AskedRunEnvironment | undefined {
  const project = useQuery({ ...projectQueries.one(projectId), enabled: asking }).data;
  const undecided = asking && project?.runEnvironment === "not-decided";
  const runEnvironment = useQuery({
    ...projectQueries.runEnvironment(projectId),
    enabled: undecided,
  }).data;
  const started = useQuery({
    queryKey: setUpStartKey(projectId),
    queryFn: (): OffBoardTaskStart | null => null,
    enabled: false,
    staleTime: Infinity,
  }).data;
  if (!undecided || !project || runEnvironment?.runEnvironment !== "not-decided") return undefined;
  const setUpTask = runEnvironment.setUpTask;
  if (!setUpTask) return { kind: "question", project };
  if (started && started.outcome !== "refused" && started.offBoardTask.taskId === setUpTask.id) {
    return { kind: "setting-up", project, offBoardTask: started.offBoardTask };
  }
  return undefined;
}

/** Start's notes' line for the Project's Run environment: the question, or the set-up after Yes. */
export function RunEnvironmentNote({ asked }: { readonly asked: AskedRunEnvironment }): ReactNode {
  return asked.kind === "question" ? (
    <RunEnvironmentQuestion project={asked.project} />
  ) : (
    <SettingUpNote project={asked.project} offBoardTask={asked.offBoardTask} />
  );
}

/**
 * The run environment question beside Start, which never waits for it: Yes acts as Set up run
 * environment, which starts its Off-board Task at once, No sets Off, and the Project's event takes
 * the line away.
 */
export function RunEnvironmentQuestion({ project }: { readonly project: Project }): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [refusal, setRefusal] = useState<readonly string[]>();
  const answering = useMutation({
    mutationFn: async (answer: StartAnswer): Promise<RunEnvironmentSetUpAnswer> =>
      answer === "yes"
        ? setUpRunEnvironment(project.id)
        : { runEnvironment: await changeRunEnvironment(project.id, "off"), start: null },
    onSuccess: ({ runEnvironment, start }, answer) => {
      queryClient.setQueryData(setUpStartKey(project.id), start);
      queryClient.setQueryData(projectQueries.runEnvironment(project.id).queryKey, runEnvironment);
      void queryClient.invalidateQueries({ queryKey: projectQueries.one(project.id).queryKey });
      setRefusal(start?.outcome === "refused" ? start.reasons : undefined);
      showToast(answerWords(answer, runEnvironment, start, project.name));
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
    <>
      <div className="task-head-note task-head-question" role="group" aria-label="Run environment">
        <Icon name="container" size={14} />
        <span>{RUN_ENVIRONMENT_QUESTION}</span>
        <span className="task-head-question-answers">
          {answerButton("yes")}
          {answerButton("no")}
        </span>
      </div>
      <div className="task-head-note task-head-question-hint">
        {setUpHintWords(project.name, project.projectLimit)}
      </div>
      {refusal && (
        <Alert tone="danger" title={SET_UP_REFUSED}>
          <ul className="refusal-reasons">
            {refusal.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}

function answerWords(
  answer: StartAnswer,
  runEnvironment: ProjectRunEnvironment,
  start: OffBoardTaskStart | null,
  projectName: string,
): string {
  if (answer === "no") return settingChosenWords(runEnvironment, projectName);
  return setUpWords({ runEnvironment, start }, projectName) ?? SET_UP_REFUSED;
}

/** After Yes: who is setting the run environment up, or its queue place, and where to follow it. */
function SettingUpNote({
  project,
  offBoardTask,
}: {
  readonly project: Project;
  readonly offBoardTask: OffBoardTask;
}): ReactNode {
  return (
    <div className="task-head-note" role="status">
      <Icon name="container" size={14} />
      <span>
        {settingUpWords(offBoardTask, project.name)} {FOLLOW_IT_ON}
        <Link to="/projects/$projectId/run-environment" params={{ projectId: project.id }}>
          {runEnvironmentLinkWords(project.name)}
        </Link>
        {TURNS_ON_WHEN_DONE}
      </span>
    </div>
  );
}
