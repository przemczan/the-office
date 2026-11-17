import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { Duty, OfficeWidePipeline, Role, StageTemplate } from "@the-office/contracts";
import { Badge, Button, Card, Icon, Menu, PickList, PickListItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { dutyQueries, roleCardQueries, roleQueries } from "../../../api/people.ts";
import {
  duplicatePipeline,
  pipelineQueries,
  stageTemplateQueries,
} from "../../../api/pipelines.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { LibraryPipelineForm } from "./library-pipeline-form.tsx";
import { AskDevopsButton } from "../../../shell/ask-devops.tsx";
import { stagesLine, whoWorks } from "../../../shell/pipelines/pipeline-words.ts";
import { builtOnByWords, counted } from "../../../shell/pipelines/stage-change-words.ts";
import {
  STAGE_KIND_ICONS,
  STAGE_KIND_NAMES,
  type StageKind,
} from "../../../shell/pipelines/stage-edits.ts";
import { BuiltOnByCard, brokenBuiltOnByTotal, builtOnByTotal } from "./built-on-by-card.tsx";
import { pipelineUseLine } from "../../../shell/pipelines/pipeline-use-words.ts";
import { StageTemplateForm, type StageTemplateOpened } from "./stage-template-form.tsx";

/** What the detail column shows when the user is making something new. */
type Making =
  { readonly what: "pipeline" } | { readonly what: "stage-template"; readonly kind: StageKind };

/**
 * Settings › Pipelines (prototypes/app/settings.js `pipelinesSection`, and for what Project Pipelines
 * add docs/design/project-pipelines.html): the office-wide Pipelines beside the open one, which the
 * user edits, duplicates or removes, and "New Pipeline" made from scratch; under it the Stage
 * templates, each opened in the same place. Project Pipelines are on their Project's page; here
 * each office-wide Pipeline says which Projects build on it. On a narrow page the lists or the open
 * item show, not one under the other.
 */
export function PipelinesSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Pipelines" });
  const { pipelineId, stageTemplateId } = useParams({ strict: false });
  const library = useQuery(pipelineQueries.list());
  const templates = useQuery(stageTemplateQueries.list());
  const roles = useQuery(roleQueries.list());
  const duties = useQuery(dutyQueries.list());
  const options = useQuery(roleCardQueries.options());
  const [making, setMaking] = useState<Making | undefined>();
  if (library.error)
    return <RefusalAlert title="The library can't be read" error={library.error} />;
  if (templates.error)
    return <RefusalAlert title="The Stage templates can't be read" error={templates.error} />;
  if (!library.data || !templates.data || !roles.data || !duties.data || !options.data) {
    return null;
  }
  const openTemplate = making ? undefined : templates.data.find(({ id }) => id === stageTemplateId);
  const open =
    making || openTemplate
      ? undefined
      : (library.data.find(({ id }) => id === pipelineId) ?? library.data[0]);
  const openedTemplate = templateOpened(openTemplate, making);
  const stopMaking = (): void => setMaking(undefined);
  const showingDetail =
    making !== undefined || pipelineId !== undefined || stageTemplateId !== undefined;
  return (
    <div className={showingDetail ? "settings-split showing-detail" : "settings-split"}>
      <div className="library-lists">
        <LibraryList
          library={library.data}
          open={open}
          making={making?.what === "pipeline"}
          onMake={() => setMaking({ what: "pipeline" })}
          onOpen={stopMaking}
        />
        <StageTemplateList
          templates={templates.data}
          open={openTemplate}
          roles={roles.data}
          duties={duties.data}
          onMake={(kind) => setMaking({ what: "stage-template", kind })}
          onOpen={stopMaking}
        />
      </div>
      <div className="library-detail">
        <Link className="settings-back" to="/settings/pipelines" onClick={stopMaking}>
          <Icon name="chevron-left" size={14} />
          All Pipelines
        </Link>
        {openedTemplate ? (
          <StageTemplateForm
            // Each template, and each new one, starts its own draft.
            key={
              openedTemplate.template ? openedTemplate.template.id : `new-${openedTemplate.kind}`
            }
            opened={openedTemplate}
            roles={roles.data}
            duties={duties.data}
            options={options.data}
            onDone={stopMaking}
          />
        ) : (
          <>
            {open && <PipelineHead pipeline={open} />}
            {open && <BuiltOnByCard pipeline={open} />}
            <LibraryPipelineForm
              // Each Pipeline, and each new one, starts its own draft.
              key={open?.id ?? "new"}
              pipeline={open}
              roles={roles.data}
              duties={duties.data}
              options={options.data}
              onDone={stopMaking}
            />
          </>
        )}
      </div>
    </div>
  );
}

function templateOpened(
  template: StageTemplate | undefined,
  making: Making | undefined,
): StageTemplateOpened | undefined {
  if (template) return { template };
  return making?.what === "stage-template" ? { kind: making.kind } : undefined;
}

function LibraryList({
  library,
  open,
  making,
  onMake,
  onOpen,
}: {
  readonly library: readonly OfficeWidePipeline[];
  readonly open: OfficeWidePipeline | undefined;
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
      name="Office-wide Pipelines"
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

/**
 * A Pipeline in the list, flagged when its Stages need fixing or name a Role nobody fills; one that
 * Project Pipelines are built from says how many, and how many are Broken.
 */
function LibraryItem({
  pipeline,
  picked,
  onOpen,
}: {
  readonly pipeline: OfficeWidePipeline;
  readonly picked: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const { id, name, description, stages } = pipeline;
  const check = useQuery(
    pipelineQueries.libraryCheck({ name, description, stages, pipelineId: id }),
  );
  const needsFixing = (check.data?.problems.length ?? 0) > 0;
  const builtOn = builtOnByTotal(pipeline);
  const broken = brokenBuiltOnByTotal(pipeline);
  return (
    <PickListItem
      picked={picked}
      name={name}
      line={stagesLine(pipeline)}
      secondLine={builtOn > 0 ? builtOnByWords(builtOn) : undefined}
      aside={
        broken > 0 && (
          <span
            title={`${counted(broken, "Project Pipeline built on it is", "Project Pipelines built on it are")} Broken`}
          >
            <Badge size="sm" tone="danger">
              {broken} Broken
            </Badge>
          </span>
        )
      }
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

/**
 * The Stage templates: "New template" in the head, a menu of the kinds, then a row per
 * template as a link to its address.
 */
function StageTemplateList({
  templates,
  open,
  roles,
  duties,
  onMake,
  onOpen,
}: {
  readonly templates: readonly StageTemplate[];
  readonly open: StageTemplate | undefined;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly onMake: (kind: StageKind) => void;
  readonly onOpen: () => void;
}): ReactNode {
  return (
    <PickList
      name="Stage templates"
      count={templates.length}
      action={<NewStageTemplateMenu onMake={onMake} />}
      empty="No Stage template yet. Make one with New template, or use Save as template on a Stage in a Pipeline."
    >
      {templates.map((template) => (
        <StageTemplateItem
          key={template.id}
          template={template}
          roles={roles}
          duties={duties}
          picked={template.id === open?.id}
          onOpen={onOpen}
        />
      ))}
    </PickList>
  );
}

function NewStageTemplateMenu({
  onMake,
}: {
  readonly onMake: (kind: StageKind) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={200}
      trigger={
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="plus" size={14} />}
          // No chevron: beside "Stage templates" and its count, the column has no room for one.
          aria-haspopup="menu"
          aria-expanded={open}
        >
          New template
        </Button>
      }
      items={(["agent", "script", "gate"] as const).map((kind) => ({
        label: STAGE_KIND_NAMES[kind],
        icon: <Icon name={STAGE_KIND_ICONS[kind]} size={14} />,
        onSelect: () => onMake(kind),
      }))}
    />
  );
}

/** A template in the list, flagged when it needs fixing or names a Role nobody fills. */
function StageTemplateItem({
  template,
  roles,
  duties,
  picked,
  onOpen,
}: {
  readonly template: StageTemplate;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly picked: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const { id, stage } = template;
  const check = useQuery(stageTemplateQueries.check({ stage, stageTemplateId: id }));
  const needsFixing = (check.data?.problems.length ?? 0) > 0;
  return (
    <PickListItem
      picked={picked}
      icon={{
        glyph: <Icon name={STAGE_KIND_ICONS[stage.kind]} size={15} strokeWidth={1.6} />,
        label: STAGE_KIND_NAMES[stage.kind],
      }}
      name={stage.name}
      line={whoWorks(stage, roles, undefined, duties)}
      warning={needsFixing ? "Needs fixing" : undefined}
      renderLink={(parts) => (
        <Link
          to="/settings/pipelines/stage-templates/$stageTemplateId"
          params={{ stageTemplateId: id }}
          onClick={onOpen}
          {...parts}
        />
      )}
    />
  );
}

/** The open Pipeline's name, description and who uses it. */
function PipelineHead({ pipeline }: { readonly pipeline: OfficeWidePipeline }): ReactNode {
  const use = useQuery(pipelineQueries.use(pipeline.id));
  return (
    <Card
      title={
        <span className="settings-block-title">
          <Icon name="route" size={15} strokeWidth={1.6} />
          {pipeline.name}
          <Badge size="sm">Office-wide</Badge>
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
