import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Card, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { dutyQueries, roleCardQueries, roleQueries } from "../../../api/people.ts";
import { pipelineQueries, projectPipelineQueries } from "../../../api/pipelines.ts";
import {
  ProjectProposalOnFlow,
  useProposalShown,
} from "../../../shell/conversation/proposal-on-flow.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useOpenProject } from "../project-page.tsx";
import { AddProjectPipelineDialog } from "./add-project-pipeline-dialog.tsx";
import { DefaultPipelineBlock } from "./default-pipeline-block.tsx";
import { ProjectPipelineForm } from "./project-pipeline-form.tsx";
import { ProjectPipelineList } from "./project-pipeline-list.tsx";
import "./project-pipelines.css";

/**
 * A Project's Pipelines section (docs/design/project-pipelines.html, "A Project's Pipelines"): its
 * default Pipeline and Publishing, then its own Project Pipelines, the open one edited beside them.
 * On a narrow page the lists or the open one show, not one under the other.
 */
export function ProjectPipelinesSection(): ReactNode {
  const project = useOpenProject();
  const { projectPipelineId } = useParams({ strict: false });
  const projectPipelines = useQuery(projectPipelineQueries.list(project.id));
  const officeWide = useQuery(pipelineQueries.list());
  const roles = useQuery(roleQueries.list());
  const duties = useQuery(dutyQueries.list());
  const options = useQuery(roleCardQueries.options());
  const [adding, setAdding] = useState(false);
  const onFlow = useProposalShown(projectPipelineId);
  const failure = projectPipelines.error ?? officeWide.error;
  if (failure)
    return <RefusalAlert title={`${project.name}'s Pipelines can't be read`} error={failure} />;
  if (
    !projectPipelines.data ||
    !officeWide.data ||
    !roles.data ||
    !duties.data ||
    !options.data ||
    onFlow.reading
  ) {
    return null;
  }
  const open = projectPipelines.data.find(({ id }) => id === projectPipelineId);
  const listName = `${project.name}'s Pipelines`;
  return (
    <div
      className={
        projectPipelineId === undefined ? "project-pipelines" : "project-pipelines showing-detail"
      }
    >
      <div className="project-pipelines-lists">
        <DefaultPipelineBlock project={project} />
        <ProjectPipelineList
          project={project}
          projectPipelines={projectPipelines.data}
          open={open}
          onAdd={() => setAdding(true)}
        />
      </div>
      <div className="project-pipelines-detail">
        <Link
          className="project-pipelines-back"
          to="/projects/$projectId/pipelines"
          params={{ projectId: project.id }}
        >
          <Icon name="chevron-left" size={14} />
          {listName}
        </Link>
        {open && onFlow.shown?.change.kind === "project-pipeline" ? (
          <ProjectProposalOnFlow
            proposal={onFlow.shown.proposal}
            change={onFlow.shown.change}
            projectName={project.name}
            roles={roles.data}
            duties={duties.data}
          />
        ) : open ? (
          <ProjectPipelineForm
            // Each Project Pipeline starts its own draft.
            key={open.id}
            project={project}
            projectPipeline={open}
            officeWide={officeWide.data}
            roles={roles.data}
            duties={duties.data}
            options={options.data}
          />
        ) : (
          <Card>
            <p className="project-block-text">
              {projectPipelineId === undefined
                ? `Open one of ${listName} to see the Stages it gets and edit it.`
                : `${project.name} has no such Pipeline: it may have been removed.`}
            </p>
          </Card>
        )}
      </div>
      {adding && (
        <AddProjectPipelineDialog
          project={project}
          officeWide={officeWide.data}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
