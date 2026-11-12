import { Link } from "@tanstack/react-router";
import type { Project, ProjectPipelineBreak } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { ProjectMark } from "../../../shell/project-mark.tsx";
import { breaksByProject, breaksTitle } from "./breaks-words.ts";

/**
 * The warning before saving an office-wide Pipeline that would break Project Pipelines
 * (docs/design/project-pipelines.html, "Saving a base Pipeline"): each one under its Project with
 * why, a link to it on its Project's page, and Save anyway.
 */
export function BreaksDialog({
  pipelineName,
  breaks,
  projects,
  saving,
  onSaveAnyway,
  onClose,
}: {
  readonly pipelineName: string;
  readonly breaks: readonly ProjectPipelineBreak[];
  readonly projects: readonly Project[];
  readonly saving: boolean;
  readonly onSaveAnyway: () => void;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      size="small"
      title={breaksTitle(pipelineName, breaks.length)}
      onClose={onClose}
      actions={
        <Button loading={saving} onClick={onSaveAnyway}>
          Save anyway
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">
          Their Stage changes name Stages this save takes out of {pipelineName}. Saved, each is
          Broken: Tasks can't choose it until its Stage changes are fixed on its Project's page.
          Tasks already started keep their Stages.
        </p>
        <ul className="breaks" aria-label="Project Pipelines it breaks">
          {breaksByProject(breaks).map(({ projectId, projectName, breaks: ofProject }) => {
            const project = projects.find(({ id }) => id === projectId);
            return (
              <li key={projectId} className="breaks-project">
                <span className="breaks-project-name">
                  {project && <ProjectMark project={project} />}
                  {projectName}
                </span>
                {ofProject.map(({ projectPipelineId, name, reasons }) => (
                  <div key={projectPipelineId} className="break-item">
                    <span className="break-item-name">{name}</span>
                    <ul>
                      {reasons.map(({ text }) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                    <Link
                      className="break-item-link"
                      to="/projects/$projectId/pipelines/$projectPipelineId"
                      params={{ projectId, projectPipelineId }}
                    >
                      Open it on {projectName}'s page
                    </Link>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
