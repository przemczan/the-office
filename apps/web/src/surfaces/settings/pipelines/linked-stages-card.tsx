import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { LinkedStage, StageTemplate } from "@the-office/contracts";
import { Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { stageTemplateQueries } from "../../../api/pipelines.ts";
import { projectQueries } from "../../../api/projects.ts";
import {
  differenceWords,
  fieldsDiffering,
  linkedPipelineWords,
} from "../../../shell/pipelines/template-link.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";

/**
 * Linked Stages · N, under an open template: each Stage of a Pipeline linked to it, with its
 * Pipeline and how it differs from the template, linking to the Stage in its Pipeline's editor. A
 * Task's own Stages are copies, so never here.
 */
export function LinkedStagesCard({ template }: { readonly template: StageTemplate }): ReactNode {
  const linked = useQuery(stageTemplateQueries.linkedStages(template.id));
  const projects = useQuery(projectQueries.list()).data;
  const stages = linked.data ?? [];
  return (
    <Card
      title={
        <span className="settings-block-title">
          <Icon name="link" size={15} strokeWidth={1.6} />
          Linked Stages
          {linked.data && <span className="settings-count">· {stages.length}</span>}
        </span>
      }
    >
      {linked.error ? (
        <RefusalAlert title="The linked Stages can't be read" error={linked.error} />
      ) : linked.data && stages.length === 0 ? (
        <p className="settings-note">No Stage is linked to it.</p>
      ) : (
        <ul className="linked-stages">
          {stages.map((each) => (
            <li key={`${each.pipelineId}/${each.stage.key}`} className="linked-stage">
              <LinkToStage linked={each}>
                <span className="linked-stage-name">{each.stage.name}</span>
                <span className="settings-note">
                  {linkedPipelineWords(
                    each.pipelineName,
                    each.projectId === null
                      ? null
                      : {
                          id: each.projectId,
                          name: projects?.find(({ id }) => id === each.projectId)?.name,
                        },
                  )}
                </span>
              </LinkToStage>
              <span className="settings-note">
                {differenceWords(fieldsDiffering(each.stage, template.stage))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The Stage picked in its Pipeline's flow editor, office-wide in Settings or in its Project. */
function LinkToStage({
  linked: { pipelineId, projectId, stage },
  children,
}: {
  readonly linked: LinkedStage;
  readonly children: ReactNode;
}): ReactNode {
  const search = { stage: stage.key };
  return projectId === null ? (
    <Link
      className="linked-stage-link"
      to="/settings/pipelines/$pipelineId"
      params={{ pipelineId }}
      search={search}
    >
      {children}
    </Link>
  ) : (
    <Link
      className="linked-stage-link"
      to="/projects/$projectId/pipelines/$projectPipelineId"
      params={{ projectId, projectPipelineId: pipelineId }}
      search={search}
    >
      {children}
    </Link>
  );
}
