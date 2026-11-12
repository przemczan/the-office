import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { OfficeWidePipeline, Project } from "@the-office/contracts";
import { Button, Dialog, Field, Input, RadioList, Textarea } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { addProjectPipeline, projectPipelineQueries } from "../../../api/pipelines.ts";
import { useAskDevops } from "../../../shell/ask-devops.tsx";
import { stagesLine } from "../../../shell/pipelines/pipeline-words.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";

/** The Onboard Pipeline's fixed id: onboarding uses it, so no Project Pipeline is built from it. */
const ONBOARD_PIPELINE = "onboard";

/**
 * Add a Pipeline to the Project (docs/design/project-pipelines.html, "Add one built from…"): the
 * base Pipeline first, then a name and a description. It starts as the base Pipeline's Stages
 * exactly, with no Stage change, and opens in the editor.
 */
export function AddProjectPipelineDialog({
  project,
  officeWide,
  onClose,
}: {
  readonly project: Project;
  readonly officeWide: readonly OfficeWidePipeline[];
  readonly onClose: () => void;
}): ReactNode {
  const bases = officeWide.filter(({ id }) => id !== ONBOARD_PIPELINE);
  const [basePipelineId, setBasePipelineId] = useState(bases[0]?.id ?? "");
  const base = bases.find(({ id }) => id === basePipelineId);
  // Filled in from the base Pipeline until the user types a name of their own.
  const [typedName, setTypedName] = useState<string | undefined>();
  const name = typedName ?? (base ? `${base.name} for ${project.name}` : "");
  const [description, setDescription] = useState("");
  const radios = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const askDevops = useAskDevops(onClose);
  const devops = askDevops.person;
  const adding = useMutation({
    mutationFn: () =>
      addProjectPipeline({
        projectId: project.id,
        name,
        description,
        basePipelineId,
        stageChanges: [],
      }),
    onSuccess: async (added) => {
      await queryClient.invalidateQueries(projectPipelineQueries.list(project.id));
      showToast(`${added.name} added to ${project.name}'s Pipelines.`);
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
      title={`Add a Pipeline to ${project.name}`}
      onClose={onClose}
      actions={
        <>
          <Button
            loading={adding.isPending}
            disabled={base === undefined}
            onClick={() => adding.mutate()}
          >
            Add the Pipeline
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
          A Project Pipeline: only {project.name}'s Tasks and its default can choose it.
        </p>
        <Field
          label="Base Pipeline"
          hint={`The office-wide Pipeline it is built from. It starts as its Stages exactly; you then insert, replace, change or remove Stages, and ${base?.name ?? "its"}'s later edits still reach it.`}
        >
          <RadioList
            label="Base Pipeline"
            name={radios}
            value={basePipelineId}
            options={bases.map((pipeline) => ({
              value: pipeline.id,
              label: (
                <span className="base-choice">
                  <span className="base-choice-name">{pipeline.name}</span>
                  <span className="base-choice-stages">{stagesLine(pipeline)}</span>
                </span>
              ),
            }))}
            onChange={setBasePipelineId}
          />
        </Field>
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
        {adding.error && <RefusalAlert title="The Pipeline wasn't added" error={adding.error} />}
        {askDevops.error && <RefusalAlert title="The chat didn't open" error={askDevops.error} />}
      </div>
    </Dialog>
  );
}
