import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { Pipeline } from "@the-office/contracts";
import { Button, Card, Icon, PickList, PickListItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleCardQueries, roleQueries } from "../../../api/people.ts";
import { duplicatePipeline, pipelineQueries } from "../../../api/pipelines.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { LibraryPipelineForm } from "./library-pipeline-form.tsx";
import { AskDevopsButton } from "../../../shell/ask-devops.tsx";
import { stagesLine } from "../../../shell/pipelines/pipeline-words.ts";
import { pipelineUseLine } from "./pipeline-use-words.ts";

/**
 * Settings › Pipelines (prototypes/app/settings.js `pipelinesSection`): the library beside the open
 * Pipeline, which the user edits, duplicates or removes, and "New Pipeline" made from scratch.
 */
export function PipelinesSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Pipelines" });
  const { pipelineId } = useParams({ strict: false });
  const library = useQuery(pipelineQueries.list());
  const roles = useQuery(roleQueries.list());
  const options = useQuery(roleCardQueries.options());
  const [making, setMaking] = useState(false);
  if (library.error)
    return <RefusalAlert title="The library can't be read" error={library.error} />;
  if (!library.data || !roles.data || !options.data) return null;
  const open = making
    ? undefined
    : (library.data.find(({ id }) => id === pipelineId) ?? library.data[0]);
  return (
    <div className="settings-split">
      <LibraryList
        library={library.data}
        open={open}
        making={making}
        onMake={() => setMaking(true)}
        onOpen={() => setMaking(false)}
      />
      <div className="library-detail">
        {open && <PipelineHead pipeline={open} />}
        <LibraryPipelineForm
          // Each Pipeline, and each new one, starts its own draft.
          key={open?.id ?? "new"}
          pipeline={open}
          roles={roles.data}
          options={options.data}
          onDone={() => setMaking(false)}
        />
      </div>
    </div>
  );
}

function LibraryList({
  library,
  open,
  making,
  onMake,
  onOpen,
}: {
  readonly library: readonly Pipeline[];
  readonly open: Pipeline | undefined;
  readonly making: boolean;
  readonly onMake: () => void;
  readonly onOpen: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const duplicating = useMutation({
    mutationFn: duplicatePipeline,
    onSuccess: async (copy) => {
      await queryClient.invalidateQueries(pipelineQueries.list());
      onOpen();
      await navigate({ to: "/settings/pipelines/$pipelineId", params: { pipelineId: copy.id } });
    },
  });
  return (
    <PickList
      name="Pipelines"
      count={library.length}
      action={
        <Button
          size="sm"
          variant="secondary"
          disabled={making}
          iconLeft={<Icon name="plus" size={14} />}
          onClick={onMake}
        >
          New Pipeline
        </Button>
      }
      empty="No Pipeline yet. Make one from scratch with New Pipeline."
      foot={
        open && (
          <>
            <Button
              size="sm"
              variant="secondary"
              loading={duplicating.isPending}
              iconLeft={<Icon name="copy" size={14} />}
              onClick={() => duplicating.mutate(open.id)}
            >
              Duplicate {open.name}
            </Button>
            {duplicating.error && (
              <RefusalAlert title="The Pipeline wasn't duplicated" error={duplicating.error} />
            )}
          </>
        )
      }
    >
      {library.map((pipeline) => (
        <LibraryItem
          key={pipeline.id}
          pipeline={pipeline}
          picked={pipeline.id === open?.id}
          onOpen={onOpen}
        />
      ))}
    </PickList>
  );
}

/** A Pipeline in the list, flagged when its Stages need fixing or name a Role nobody fills. */
function LibraryItem({
  pipeline,
  picked,
  onOpen,
}: {
  readonly pipeline: Pipeline;
  readonly picked: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const { id, name, description, stages } = pipeline;
  const check = useQuery(
    pipelineQueries.libraryCheck({ name, description, stages, pipelineId: id }),
  );
  const needsFixing = (check.data?.problems.length ?? 0) + (check.data?.flags.length ?? 0) > 0;
  return (
    <PickListItem
      picked={picked}
      name={name}
      line={stagesLine(pipeline)}
      warning={needsFixing ? "Needs fixing" : undefined}
      renderLink={(parts) => (
        <Link
          to="/settings/pipelines/$pipelineId"
          params={{ pipelineId: id }}
          onClick={onOpen}
          {...parts}
        />
      )}
    />
  );
}

/** The open Pipeline's name, description and who uses it. */
function PipelineHead({ pipeline }: { readonly pipeline: Pipeline }): ReactNode {
  const use = useQuery(pipelineQueries.use(pipeline.id));
  return (
    <Card
      title={
        <span className="settings-block-title">
          <Icon name="route" size={15} strokeWidth={1.6} />
          {pipeline.name}
        </span>
      }
      actions={
        <AskDevopsButton
          label={(name) => `Ask ${name}`}
          draft={`Can you propose a change to the ${pipeline.name} Pipeline? `}
        />
      }
    >
      {pipeline.description !== "" && <p>{pipeline.description}</p>}
      {use.data && <p className="settings-note">{pipelineUseLine(use.data)}</p>}
    </Card>
  );
}
