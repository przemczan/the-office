import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type {
  Duty,
  Proposal,
  ProposedChange,
  ProposedRoutes,
  Role,
  Stage,
  StagePosition,
} from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useMemo, type ReactNode } from "react";
import { proposalQueries } from "../../api/conversations.ts";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import { useChatDrawerLayout } from "../chat/chat-drawer-width.ts";
import { useChat } from "../chat/use-chat.tsx";
import { FlowEditor, useFlowEditorControls } from "../pipelines/flow/flow-editor.tsx";
import { flowSummary } from "../pipelines/flow/flow-editor-words.ts";
import { asFlow } from "../pipelines/flow/flow-model.ts";
import {
  layoutSentences,
  proposalFlow,
  routesOutSentence,
} from "../pipelines/flow/proposal-flow.ts";
import { whoWorks } from "../pipelines/pipeline-words.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { RoutesOutChange } from "./proposed-route-changes.tsx";
import { useAnswering } from "./use-answering.ts";
import "./conversation.css";

type ProposedPipelineChange = Extract<ProposedChange, { kind: "pipeline" }>;
type ProposedProjectPipeline = Extract<ProposedChange, { kind: "project-pipeline" }>;

/** A Proposal of a Pipeline's routes, which Show it on the flow can open. */
type ProposedRoutesChange = (ProposedPipelineChange | ProposedProjectPipeline) & {
  readonly routes: ProposedRoutes;
};

/**
 * Show it on the flow (docs/design/pipeline-flow.html): opens the Pipeline in
 * Settings › Pipelines, or the Project Pipeline on its Project page, with the Proposal over it.
 * Below 901px the chat covers the page, so it closes; the banner's Back to the Thread opens it again.
 */
export function ShowOnFlowButton({ proposal }: { readonly proposal: Proposal }): ReactNode {
  const navigate = useNavigate();
  const chat = useChat();
  const { place } = useChatDrawerLayout();
  const { change } = proposal;
  const search = { proposal: proposal.id };
  const open = (): void => {
    if (place !== "beside") chat.close();
    if (change.kind === "pipeline") {
      void navigate({
        to: "/settings/pipelines/$pipelineId",
        params: { pipelineId: change.pipelineId },
        search,
      });
    } else if (change.kind === "project-pipeline" && change.pipelineId !== null) {
      void navigate({
        to: "/projects/$projectId/pipelines/$projectPipelineId",
        params: { projectId: change.projectId, projectPipelineId: change.pipelineId },
        search,
      });
    }
  };
  return (
    <Button
      size="sm"
      variant="secondary"
      iconLeft={<Icon name="workflow" size={12} />}
      onClick={open}
    >
      Show it on the flow
    </Button>
  );
}

/** Whether a Proposal can be shown on the flow: open, of routes, and of a Pipeline that exists. */
export function showsOnFlow(proposal: Proposal): boolean {
  const { change } = proposal;
  if (proposal.status.kind !== "open") return false;
  if (change.kind === "pipeline") return change.routes !== null;
  return change.kind === "project-pipeline" && change.routes !== null && change.pipelineId !== null;
}

/**
 * The Proposal the address's `?proposal=` names, while it is still open and changes the routes of
 * the Pipeline `pipelineId` names; undefined otherwise, so the editor opens as usual. `reading`
 * holds the page while it is read, so the editor doesn't open first and then give way.
 */
export function useProposalShown(pipelineId: string | undefined): {
  readonly reading: boolean;
  readonly shown:
    { readonly proposal: Proposal; readonly change: ProposedRoutesChange } | undefined;
} {
  const { proposal: id } = useSearch({ strict: false });
  const read = useQuery({ ...proposalQueries.one(id ?? ""), enabled: id !== undefined });
  const proposal = read.data;
  const change = proposal && routesChangeOf(proposal, pipelineId);
  return {
    reading: id !== undefined && read.isPending,
    shown: proposal && change ? { proposal, change } : undefined,
  };
}

function routesChangeOf(
  proposal: Proposal,
  pipelineId: string | undefined,
): ProposedRoutesChange | undefined {
  const { change } = proposal;
  if (proposal.status.kind !== "open") return undefined;
  if (change.kind !== "pipeline" && change.kind !== "project-pipeline") return undefined;
  if (change.pipelineId !== pipelineId || change.routes === null) return undefined;
  return { ...change, routes: change.routes };
}

interface OnFlowProps {
  readonly proposal: Proposal;
  /** Where the Pipeline's End stands now, which a Proposal that doesn't move it keeps. */
  readonly endPosition?: StagePosition | undefined;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
}

/** An office-wide Pipeline's Proposal on its flow in Settings › Pipelines. */
export function OfficeProposalOnFlow({
  proposal,
  endPosition,
  change,
  pipelineName,
  roles,
  duties,
}: OnFlowProps & {
  readonly change: ProposedPipelineChange & { readonly routes: ProposedRoutes };
  readonly pipelineName: string;
}): ReactNode {
  return (
    <ProposalOnFlow
      proposal={proposal}
      routes={change.routes}
      stages={change.to}
      endPosition={change.endPosition ?? endPosition}
      was={change.from}
      title="Stages and routes"
      pipelineName={pipelineName}
      changes={[pipelineQueries.list().queryKey]}
      appliedToast={`${pipelineName} changed. Tasks that haven't started follow it.`}
      whoWorks={(stage) => whoWorks(stage, roles, undefined, duties)}
      roles={roles}
    />
  );
}

/** A Project Pipeline's Proposal on its flow on the Project page. */
export function ProjectProposalOnFlow({
  proposal,
  endPosition,
  change,
  roles,
  duties,
}: OnFlowProps & {
  readonly change: ProposedProjectPipeline & { readonly routes: ProposedRoutes };
}): ReactNode {
  return (
    <ProposalOnFlow
      proposal={proposal}
      routes={change.routes}
      stages={change.to.stages}
      endPosition={change.to.endPosition ?? endPosition}
      was={change.from?.stages ?? change.to.stages}
      title="Stages and routes"
      pipelineName={change.to.name}
      changes={[
        pipelineQueries.list().queryKey,
        projectPipelineQueries.list(change.projectId).queryKey,
      ]}
      appliedToast={`${change.to.name} saved. Tasks that haven't started follow it.`}
      whoWorks={(stage) => whoWorks(stage, roles, undefined, duties)}
      roles={roles}
    />
  );
}

/**
 * The flow editor read-only under the Proposal's ember banner: the routes it proposes dashed, those
 * it takes away dotted. Picking a changed Stage shows its routes as Was and Proposed under it.
 */
function ProposalOnFlow(props: {
  readonly proposal: Proposal;
  readonly routes: ProposedRoutes;
  /** The flow as proposed. */
  readonly stages: readonly Stage[];
  /** Where the Proposal puts End; absent, where it is derived. */
  readonly endPosition: StagePosition | undefined;
  /** The flow as it is, which names the Stages the routes taken away lead to. */
  readonly was: readonly Stage[];
  readonly title: string;
  readonly pipelineName: string;
  readonly changes: readonly QueryKey[];
  readonly appliedToast: string;
  readonly whoWorks: (stage: Stage) => string;
  readonly roles: readonly Role[];
}): ReactNode {
  const { proposal, routes } = props;
  const stages = useMemo(() => asFlow(props.stages), [props.stages]);
  const flow = useMemo(() => proposalFlow(stages, routes), [stages, routes]);
  const controls = useFlowEditorControls();
  const draftedBy =
    props.roles.find(({ key }) => key === proposal.draftedBy)?.card.name ?? proposal.draftedBy;
  const picked = routes.stages.find(({ stageKey }) => stageKey === controls.picked?.key);
  return (
    <div className="proposal-on-flow">
      <ProposalBanner {...props} stages={stages} was={asFlow(props.was)} draftedBy={draftedBy} />
      <FlowEditor
        title={props.title}
        summary={flowSummary(stages)}
        stages={flow.stages}
        endPosition={props.endPosition}
        overlay={flow.overlay}
        problems={[]}
        warnings={routes.check}
        whoWorks={props.whoWorks}
        readOnly
        legend={<ProposalLegend draftedBy={draftedBy} />}
        controls={controls}
        panel={
          picked && (
            <ul className="proposal-changes">
              <RoutesOutChange change={picked} was={props.was} proposed={stages} />
            </ul>
          )
        }
      />
    </div>
  );
}

function ProposalBanner({
  proposal,
  routes,
  stages,
  was,
  pipelineName,
  draftedBy,
  changes,
  appliedToast,
}: {
  readonly proposal: Proposal;
  readonly routes: ProposedRoutes;
  readonly stages: readonly Stage[];
  /** The flow as it was when the Proposal was drafted. */
  readonly was: readonly Stage[];
  readonly pipelineName: string;
  readonly draftedBy: string;
  readonly changes: readonly QueryKey[];
  readonly appliedToast: string;
}): ReactNode {
  const showToast = useToast();
  const navigate = useNavigate();
  const chat = useChat();
  const { place } = useChatDrawerLayout();
  const leave = (): void =>
    void navigate({
      to: ".",
      search: (current) => ({ ...current, proposal: undefined }),
      replace: true,
      resetScroll: false,
    });
  const answering = useAnswering(
    proposal,
    [...changes, proposalQueries.one(proposal.id).queryKey],
    () => {
      showToast(appliedToast);
      leave();
    },
  );
  const sentences = [
    ...routes.stages.map((change) => routesOutSentence(change, stages)),
    ...layoutSentences(was, stages),
  ];
  return (
    <section
      className="proposal-banner"
      role="status"
      aria-label={`${draftedBy}'s Proposal, shown on ${pipelineName}`}
    >
      <Icon name="route" size={16} />
      <div className="proposal-banner-words">
        <b>
          {draftedBy}'s Proposal, shown on {pipelineName}: not applied yet
        </b>
        <p>
          {sentences.join(" ")} Dashed lines are what it proposes; dotted ones, what it takes away.
          Nothing changes until you apply it.
        </p>
        <div className="proposal-banner-actions">
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() => answering.applying.mutate({})}
          >
            Apply change
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate(undefined, { onSuccess: leave })}
          >
            Not now
          </Button>
          {place !== "beside" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => chat.open(proposal.draftedBy, proposal.threadId)}
            >
              Back to the Thread
            </Button>
          )}
        </div>
        {answering.error && (
          <RefusalAlert title="The change can't be applied yet" error={answering.error} />
        )}
      </div>
    </section>
  );
}

function ProposalLegend({ draftedBy }: { readonly draftedBy: string }): ReactNode {
  return (
    <ul className="flow-editor-legend" aria-label="What the lines mean">
      <li>
        <span className="flow-editor-legend-line" />
        As it is
      </li>
      <li>
        <span className="flow-editor-legend-line flow-editor-legend-line--proposed" />
        Proposed by {draftedBy}
      </li>
      <li>
        <span className="flow-editor-legend-line flow-editor-legend-line--taken-away" />
        Taken away
      </li>
      <li>
        <span className="flow-editor-legend-mark">≤N×</span>
        At most N times
      </li>
    </ul>
  );
}
