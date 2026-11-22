import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, Role, WaitingForYouItem } from "@the-office/contracts";
import { Badge, TextButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { useChat } from "../chat/use-chat.tsx";
import { ItemCard } from "../item-card.tsx";
import { roleFirstName } from "../person-name.ts";
import { ProjectChip } from "../project-chip.tsx";
import { InOtherProjectsNote } from "../project-filter/in-other-projects-note.tsx";
import type { Narrowed } from "../project-filter/project-filter-choices.ts";
import { clockOf } from "../time.ts";
import { waitingForYouWords } from "./now-words.ts";
import {
  officeUpdateWords,
  pullRequestTroubleWords,
  skillUpdatesWords,
  WAITING_FOR_YOU_KIND_NAMES,
  WAITING_FOR_YOU_KIND_TONES,
} from "./waiting-for-you-words.ts";
import "./notifications.css";

type ItemOf<Kind extends WaitingForYouItem["kind"]> = Extract<WaitingForYouItem, { kind: Kind }>;

/**
 * Needs you's second group (spec §2.4.2, "Waiting for you"), under the Decisions and Gates on Now
 * and in the Needs you panel: what waits on the user without blocking anyone, oldest first, with its
 * own count, which Needs you's never adds. Shown only while it holds an item in the Projects shown.
 */
export function WaitingForYouGroup({
  waitingForYou,
}: {
  readonly waitingForYou: Narrowed<WaitingForYouItem>;
}): ReactNode {
  const { shown, elsewhere } = waitingForYou;
  if (shown.length === 0) return null;
  return (
    <section className="waiting-for-you" aria-label="Waiting for you">
      <h3 className="waiting-for-you-heading">
        Waiting for you
        <span className="waiting-for-you-count">{shown.length}</span>
      </h3>
      <WaitingForYouFeed items={shown} />
      <InOtherProjectsNote
        count={elsewhere}
        one={waitingForYouWords(1)}
        many={waitingForYouWords(2)}
      />
    </section>
  );
}

/** Each item a card naming its kind and linking to where it is handled. */
export function WaitingForYouFeed({
  items,
}: {
  readonly items: readonly WaitingForYouItem[];
}): ReactNode {
  const projects = useQuery(projectQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  return items.map((item) => {
    switch (item.kind) {
      case "proposal":
        return (
          <WaitingProposal key={item.proposalId} item={item} projects={projects} roles={roles} />
        );
      case "pull-request":
        return <WaitingPullRequest key={item.pullRequestId} item={item} projects={projects} />;
      case "skill-updates":
        return <WaitingSkillUpdates key="skill-updates" item={item} projects={projects} />;
      case "office-update":
        return <WaitingOfficeUpdate key="office-update" item={item} projects={projects} />;
      case "shaping-reply":
        return (
          <WaitingShapingReply
            key={item.initiativeId}
            item={item}
            projects={projects}
            roles={roles}
          />
        );
    }
  });
}

interface ProjectsProps {
  readonly projects: readonly Project[] | undefined;
}

interface PeopleProps extends ProjectsProps {
  readonly roles: readonly Role[] | undefined;
}

/** A Proposal opens its Thread at its card: in the chat drawer, or on its Task's or Initiative's page. */
function WaitingProposal({
  item,
  projects,
  roles,
}: PeopleProps & { readonly item: ItemOf<"proposal"> }): ReactNode {
  const chat = useChat();
  const what = `Drafted by ${roleFirstName(item.draftedBy, roles)}`;
  const { home, threadId, proposalId } = item;
  return (
    <WaitingCard item={item} what={what} projects={projects}>
      {home.kind === "chat" ? (
        <TextButton
          className="needs-you-title"
          onClick={() => chat.open(home.roleKey, threadId, { proposal: proposalId })}
        >
          {what}
        </TextButton>
      ) : home.kind === "task" ? (
        <Link
          to="/tasks/$taskId"
          params={{ taskId: home.taskId }}
          search={{ taskThread: threadId, proposal: proposalId }}
          className="needs-you-title"
        >
          {what}
        </Link>
      ) : (
        <Link
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId: home.initiativeId }}
          search={{ initiativeThread: threadId, proposal: proposalId }}
          className="needs-you-title"
        >
          {what}
        </Link>
      )}
    </WaitingCard>
  );
}

/** Handled on its Task, under the Task's title, and on GitHub. */
function WaitingPullRequest({
  item,
  projects,
}: ProjectsProps & { readonly item: ItemOf<"pull-request"> }): ReactNode {
  const task = useQuery(taskQueries.one(item.taskId)).data;
  const pullRequest = `#${item.number}`;
  return (
    <WaitingCard
      item={item}
      what={task?.title ?? pullRequest}
      projects={projects}
      detail={
        <>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {pullRequest} on GitHub
          </a>
          <span>·</span>
          {pullRequestTroubleWords(item)}
        </>
      }
    >
      <Link to="/tasks/$taskId" params={{ taskId: item.taskId }} className="needs-you-title">
        {task?.title ?? pullRequest}
      </Link>
    </WaitingCard>
  );
}

function WaitingSkillUpdates({
  item,
  projects,
}: ProjectsProps & { readonly item: ItemOf<"skill-updates"> }): ReactNode {
  const what = skillUpdatesWords(item.count);
  return (
    <WaitingCard item={item} what={what} projects={projects} detail={item.skillNames.join(", ")}>
      <Link to="/settings/skills" className="needs-you-title">
        {what}
      </Link>
    </WaitingCard>
  );
}

function WaitingOfficeUpdate({
  item,
  projects,
}: ProjectsProps & { readonly item: ItemOf<"office-update"> }): ReactNode {
  const what = officeUpdateWords(item.target);
  return (
    <WaitingCard item={item} what={what} projects={projects}>
      <Link to="/settings/updates" className="needs-you-title">
        {what}
      </Link>
    </WaitingCard>
  );
}

function WaitingShapingReply({
  item,
  projects,
  roles,
}: PeopleProps & { readonly item: ItemOf<"shaping-reply"> }): ReactNode {
  const what = `${roleFirstName(item.roleKey, roles)} answered`;
  return (
    <WaitingCard item={item} what={what} projects={projects}>
      <Link
        to="/work/initiatives/$initiativeId"
        params={{ initiativeId: item.initiativeId }}
        search={{ initiativeThread: item.threadId }}
        className="needs-you-title"
      >
        {what}
      </Link>
    </WaitingCard>
  );
}

/**
 * Every card's frame: its kind's badge, the link to where it is handled (`children`), its
 * Projects, and under them what else it says and how long it has waited.
 */
function WaitingCard({
  item,
  what,
  projects,
  detail,
  children,
}: ProjectsProps & {
  readonly item: WaitingForYouItem;
  /** What the card is, for assistive technology after its kind. */
  readonly what: string;
  readonly detail?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const kind = WAITING_FOR_YOU_KIND_NAMES[item.kind];
  const { waitingSince } = item;
  return (
    <ItemCard edge="message" label={`${kind}: ${what}`}>
      <div className="needs-you-item">
        <div className="needs-you-heading">
          <Badge tone={WAITING_FOR_YOU_KIND_TONES[item.kind]}>{kind}</Badge>
          {children}
          {item.projectIds.map((projectId) => (
            <ProjectChip key={projectId} projectId={projectId} projects={projects} />
          ))}
        </div>
        {(detail !== undefined || waitingSince !== null) && (
          <div className="waiting-for-you-sub">
            {detail}
            {detail !== undefined && waitingSince !== null && <span>·</span>}
            {waitingSince !== null && (
              <time dateTime={waitingSince} title="Waiting since">
                {clockOf(waitingSince)}
              </time>
            )}
          </div>
        )}
      </div>
    </ItemCard>
  );
}
