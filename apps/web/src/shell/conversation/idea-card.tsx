import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Idea, Message } from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries } from "../../api/work.ts";
import { ProjectChip } from "../project-chip.tsx";
import { RecordMention } from "../record-mention.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { dayAndClockOf } from "../time.ts";
import { ShapeIdeaDialog } from "../work/shape-idea-dialog.tsx";
import { useIdeaPlanning } from "../work/use-idea-planning.ts";
import { usePlanner } from "../work/use-planner.ts";
import "./conversation.css";

type IdeaCardMessage = Extract<Message, { kind: "idea" }>;

/**
 * An Idea the person captured in the chat (spec §2.2), as Work holds it now: still new, it is
 * planned as a Task with the Planner from here; shaped, it links its Task or Initiative.
 */
export function IdeaCard({ card }: { readonly card: IdeaCardMessage }): ReactNode {
  const idea = useQuery(ideaQueries.one(card.ideaId));
  if (idea.isError) {
    return (
      <div className="message-line failed">
        <Icon name="circle-alert" size={12} />
        <span className="message-summary">
          The captured Idea can't be read: {idea.error.message}
        </span>
      </div>
    );
  }
  if (!idea.data) return null;
  return <CapturedIdea idea={idea.data} />;
}

function CapturedIdea({ idea }: { readonly idea: Idea }): ReactNode {
  const projects = useQuery(projectQueries.list()).data;
  return (
    <section className="message chat-card" aria-label={`Idea: ${idea.title}`}>
      <div className="chat-card-head">
        <Icon name="lightbulb" size={16} />
        <div className="chat-card-text">
          <span className="chat-card-title">{idea.title}</span>
          <span className="chat-card-sub">
            Idea · captured {dayAndClockOf(idea.capturedAt)} ·{" "}
            <ProjectChip projectId={idea.projectId} projects={projects} />
          </span>
        </div>
      </div>
      <div className="proposal-foot">
        <IdeaFoot idea={idea} />
      </div>
    </section>
  );
}

function IdeaFoot({ idea }: { readonly idea: Idea }): ReactNode {
  switch (idea.state) {
    case "shaped":
      return (
        <>
          <Badge tone="success">Shaped</Badge>
          {idea.taskId !== null && (
            <RecordMention link={{ kind: "task", taskId: idea.taskId }} written="its Task" />
          )}
          {idea.initiativeId !== null && (
            <RecordMention
              link={{ kind: "initiative", initiativeId: idea.initiativeId }}
              written="its Initiative"
            />
          )}
        </>
      );
    case "dropped":
      return <Badge tone="neutral">Dropped</Badge>;
    case "new":
      return <NewIdeaActions idea={idea} />;
  }
}

/** Plan as a Task with the Planner, when one is hired; an Office-wide Idea picks its Project first. */
function NewIdeaActions({ idea }: { readonly idea: Idea }): ReactNode {
  const planner = usePlanner();
  const planning = useIdeaPlanning(idea);
  const [choosingProject, setChoosingProject] = useState(false);
  const label = `Plan as a Task with ${planner?.card.name ?? "the Planner"}`;
  return (
    <>
      {planner && (
        <Button
          size="sm"
          iconLeft={<Icon name="map" size={14} />}
          loading={planning.isPending}
          onClick={() => {
            if (idea.projectId === null) setChoosingProject(true);
            else planning.mutate(idea.projectId);
          }}
        >
          {label}
        </Button>
      )}
      <Link className="proposal-link" to="/work/ideas" search={{ idea: idea.id }}>
        Open in Ideas
      </Link>
      {planning.error && !choosingProject && (
        <RefusalAlert title="The Idea can't be planned" error={planning.error} />
      )}
      {choosingProject && (
        <ShapeIdeaDialog
          idea={idea}
          shaping={planning}
          actionLabel={label}
          onClose={() => setChoosingProject(false)}
        />
      )}
    </>
  );
}
