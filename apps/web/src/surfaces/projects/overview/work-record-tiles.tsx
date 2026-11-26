import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project } from "@the-office/contracts";
import { Badge, Icon, ProgressBar, Timeline, type TimelineItem } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../../api/projects.ts";
import { ideaQueries, initiativeQueries, taskQueries } from "../../../api/work.ts";
import { checkedWords } from "../../../shell/code-host-words.ts";
import { useClock } from "../../../shell/use-clock.ts";
import { progressWords } from "../../../shell/work/initiative-progress.ts";
import {
  ACTIVITY_DAYS,
  ACTIVITY_LEADS,
  activityLines,
  initiativesOfProject,
  newIdeasOfProject,
  settingChangeWords,
  type ActivityLine,
  type OverviewInitiative,
} from "./overview-words.ts";
import { OverviewTile, TileEmpty, useNarrowToProject } from "./overview-tile.tsx";

/** How many of the newest New Ideas the Ideas tile names. */
const NEWEST_IDEAS = 3;

/** The Project's Shaping and Active Initiatives, each with how far its Tasks are. */
export function InitiativesTile({ project }: { readonly project: Project }): ReactNode {
  const initiatives = useQuery(initiativeQueries.list());
  const tasks = useQuery(taskQueries.list());
  const narrow = useNarrowToProject(project.id);
  return (
    <OverviewTile
      icon="flag"
      title="Initiatives"
      wide
      link={
        <Link to="/work/initiatives" className="project-block-link" onClick={narrow}>
          All Initiatives
        </Link>
      }
      readings={[initiatives, tasks]}
    >
      {() => {
        const projectInitiatives = initiativesOfProject(
          initiatives.data ?? [],
          tasks.data ?? [],
          project.id,
        );
        if (projectInitiatives.length === 0) {
          return <TileEmpty>No Initiative spans {project.name} right now.</TileEmpty>;
        }
        return (
          <ul className="project-overview-list">
            {projectInitiatives.map((going) => (
              <InitiativeRow key={going.initiative.id} going={going} />
            ))}
          </ul>
        );
      }}
    </OverviewTile>
  );
}

function InitiativeRow({ going }: { readonly going: OverviewInitiative }): ReactNode {
  const { initiative, progress } = going;
  return (
    <li className="project-overview-initiative">
      <span className="project-overview-row">
        <Link
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId: initiative.id }}
          className="project-overview-name"
        >
          {initiative.name}
        </Link>
        {initiative.state === "shaping" && (
          <Badge tone="neutral" size="sm">
            Shaping
          </Badge>
        )}
        {initiative.pausedAt !== null && (
          <Badge tone="warning" size="sm">
            <Icon name="pause" size={11} />
            Paused
          </Badge>
        )}
      </span>
      {progress.counted > 0 && (
        <span className="project-overview-progress">
          <ProgressBar
            value={progress.done}
            max={progress.counted}
            tone="success"
            size="sm"
            valueLabel=""
          />
          <span>{progressWords(progress)}</span>
        </span>
      )}
    </li>
  );
}

/** How many New Ideas the Project has, naming the newest. */
export function IdeasTile({ project }: { readonly project: Project }): ReactNode {
  const ideas = useQuery(ideaQueries.list());
  const narrow = useNarrowToProject(project.id);
  return (
    <OverviewTile
      icon="lightbulb"
      title="Ideas"
      link={
        <Link to="/work/ideas" className="project-block-link" onClick={narrow}>
          Open Ideas
        </Link>
      }
      readings={[ideas]}
    >
      {() => {
        const fresh = newIdeasOfProject(ideas.data ?? [], project.id);
        if (fresh.length === 0) return <TileEmpty>No new Ideas for {project.name}.</TileEmpty>;
        return (
          <>
            <p className="project-overview-count">
              <b>{fresh.length}</b> {fresh.length === 1 ? "New Idea" : "New Ideas"}
            </p>
            <ul className="project-overview-list">
              {fresh.slice(0, NEWEST_IDEAS).map((idea) => (
                <li key={idea.id} className="project-overview-row">
                  <Link
                    to="/work/ideas"
                    search={{ idea: idea.id }}
                    className="project-overview-name"
                  >
                    {idea.title}
                  </Link>
                  <span className="project-overview-age">{checkedWords(idea.capturedAt)}</span>
                </li>
              ))}
            </ul>
          </>
        );
      }}
    </OverviewTile>
  );
}

/** The Project's Tasks done or published and Ideas captured lately, newest first. */
export function RecentActivityTile({ project }: { readonly project: Project }): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const ideas = useQuery(ideaQueries.list());
  const settingChanges = useQuery(projectQueries.settingChanges(project.id));
  const now = useClock();
  return (
    <OverviewTile
      icon="history"
      title="Recent activity"
      wide
      link={
        <Link to="/work" className="project-block-link">
          Open in Work
        </Link>
      }
      readings={[tasks, ideas, settingChanges]}
    >
      {() => {
        const lines = activityLines(
          tasks.data ?? [],
          ideas.data ?? [],
          settingChanges.data ?? [],
          project.id,
          now,
        );
        if (lines.length === 0) {
          return <TileEmpty>Nothing in the last {ACTIVITY_DAYS} days.</TileEmpty>;
        }
        return <Timeline items={lines.map(timelineItemOf)} />;
      }}
    </OverviewTile>
  );
}

function timelineItemOf(line: ActivityLine): TimelineItem {
  const time = checkedWords(line.at);
  if (line.kind === "setting-changed") {
    const { change } = line;
    const { who, what } = settingChangeWords(change);
    return {
      id: `setting-${change.id}`,
      icon: "settings",
      tone: "neutral",
      actor: who,
      title:
        change.by.kind === "person" && change.by.taskId !== undefined ? (
          <Link to="/tasks/$taskId" params={{ taskId: change.by.taskId }}>
            {what}
          </Link>
        ) : (
          what
        ),
      time,
    };
  }
  if (line.kind === "idea-captured") {
    return {
      id: `idea-${line.idea.id}`,
      icon: "lightbulb",
      tone: "info",
      actor: ACTIVITY_LEADS[line.kind],
      title: (
        <Link to="/work/ideas" search={{ idea: line.idea.id }}>
          {line.idea.title}
        </Link>
      ),
      time,
    };
  }
  const taskLink = (
    <Link to="/tasks/$taskId" params={{ taskId: line.task.id }}>
      {line.task.title}
    </Link>
  );
  return {
    id: `${line.kind}-${line.task.id}`,
    icon: line.kind === "done" ? "circle-check" : "upload",
    tone: "success",
    actor: ACTIVITY_LEADS[line.kind],
    title: line.kind === "done" && line.published ? <>{taskLink} · published</> : taskLink,
    time,
  };
}
