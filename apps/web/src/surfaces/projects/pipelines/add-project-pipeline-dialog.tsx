import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { OfficeWidePipeline, Pipeline, Project, ProjectPipeline } from "@the-office/contracts";
import { Button, Dialog, Input, RadioList, Textarea } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { addProjectPipeline, projectPipelineQueries } from "../../../api/pipelines.ts";
import { useAskDevops } from "../../../shell/ask-devops.tsx";
import { stagesLine } from "../../../shell/pipelines/pipeline-words.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";

/** The Onboard Pipeline's fixed id: onboarding uses it, so no Project Pipeline is copied from it. */
const ONBOARD_PIPELINE = "onboard";

/**
 * Copy a Pipeline into the Project (spec screens/project-page.md, "Copy a Pipeline window"): an
 * office-wide Pipeline, never Onboard, or one of the Project's own, then a name and a description.
 * The copy gets its Stages, routes and places as they are, and opens in the editor.
 */
export function AddProjectPipelineDialog({
  project,
  officeWide,
  projectPipelines,
  onClose,
}: {
  readonly project: Project;
  readonly officeWide: readonly OfficeWidePipeline[];
  readonly projectPipelines: readonly ProjectPipeline[];
  readonly onClose: () => void;
}): ReactNode {
  const groups: readonly { label: string; pipelines: readonly Pipeline[] }[] = [
    {
      label: "Office-wide Pipelines",
      pipelines: officeWide.filter(({ id }) => id !== ONBOARD_PIPELINE),
    },
    { label: `${project.name}'s Pipelines`, pipelines: projectPipelines },
  ].filter(({ pipelines }) => pipelines.length > 0);
  const choices = groups.flatMap(({ pipelines }) => pipelines);
  const [copyOf, setCopyOf] = useState(choices[0]?.id ?? "");
  const copied = choices.find(({ id }) => id === copyOf);
  // Filled in from the one copied until the user types a name of their own.
  const [typedName, setTypedName] = useState<string | undefined>();
  const name = typedName ?? (copied ? `${copied.name} for ${project.name}` : "");
  const [description, setDescription] = useState("");
  const radios = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const askDevops = useAskDevops(onClose);
  const devops = askDevops.person;
  const copying = useMutation({
    mutationFn: () => addProjectPipeline({ projectId: project.id, copyOf, name, description }),
    onSuccess: async (added) => {
      await queryClient.invalidateQueries(projectPipelineQueries.list(project.id));
      void queryClient.invalidateQueries(projectPipelineQueries.needingFixing(project.id));
      showToast(`${added.name} copied into ${project.name}'s Pipelines.`);
      onClose();
      await navigate({
        to: "/projects/$projectId/pipelines/$projectPipelineId",
        params: { projectId: project.id, projectPipelineId: added.id },
      });
    },
  });
  return (
    <Dialog
      size="medium"
      keepsHeight
      title={`Copy a Pipeline into ${project.name}`}
      onClose={onClose}
      actions={
        <>
          <Button
            loading={copying.isPending}
            disabled={copied === undefined}
            onClick={() => copying.mutate()}
          >
            Copy into {project.name}
          </Button>
          {devops && (
            <Button
              variant="secondary"
              loading={askDevops.asking}
              onClick={() =>
                askDevops.ask(`Can you propose a Project Pipeline for ${project.name}? `)
              }
            >
              Ask {devops.card.name} instead
            </Button>
          )}
        </>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">
          A Project Pipeline: only {project.name}&apos;s Tasks and its default can choose it. Edits
          of the one it is copied from never reach it.
        </p>
        {groups.map(({ label, pipelines }) => (
          <div key={label} className="copy-choices">
            <h4 className="copy-choices-label">{label}</h4>
            <RadioList
              label={label}
              name={radios}
              value={copyOf}
              options={pipelines.map((pipeline) => ({
                value: pipeline.id,
                label: (
                  <span className="copy-choice">
                    <span className="copy-choice-name">{pipeline.name}</span>
                    <span className="copy-choice-stages">{stagesLine(pipeline)}</span>
                  </span>
                ),
              }))}
              onChange={setCopyOf}
            />
          </div>
        ))}
        <Input
          label="Name"
          hint={`Not a name an office-wide Pipeline or another of ${project.name}'s has.`}
          value={name}
          onChange={(event) => setTypedName(event.target.value)}
        />
        <Textarea
          label="Description"
          rows={2}
          placeholder="What it is for, in a sentence"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {copying.error && <RefusalAlert title="The Pipeline wasn't copied" error={copying.error} />}
        {askDevops.error && <RefusalAlert title="The chat didn't open" error={askDevops.error} />}
      </div>
    </Dialog>
  );
}
