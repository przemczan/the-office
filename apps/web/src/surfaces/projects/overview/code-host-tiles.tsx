import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  OFFICE_IDENTITY_SETTINGS_PATH,
  type CiRun,
  type Project,
  type PullRequest,
} from "@the-office/contracts";
import { Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import { ciRunQueries } from "../../../api/ci-runs.ts";
import { projectQueries } from "../../../api/projects.ts";
import { pullRequestQueries } from "../../../api/pull-requests.ts";
import { CI_RUN_STATUS_WORDS } from "../../../shell/ci-run-status-words.ts";
import {
  CHECKS_WORDS,
  checkedWords,
  ciRunName,
  ciRunProblemWords,
  MERGEABLE_WORDS,
  pullRequestName,
  pullRequestProblemWords,
  shortCommit,
} from "../../../shell/code-host-words.ts";
import { ToneBadge } from "../../../shell/tone-badge.tsx";
import { OverviewTile, TileEmpty, useNarrowToProject } from "./overview-tile.tsx";
import { newestCiRuns, remoteSignIn } from "./overview-words.ts";

/** Only GitHub repositories list their CI runs (spec §2.12). */
const CI_CODE_HOST = "GitHub";
/** How many open pull requests the Pull requests tile names. */
const NEWEST_PULL_REQUESTS = 3;

/** The newest CI run on the base branch, and the newest on any branch when that is newer. */
export function CiTile({ project }: { readonly project: Project }): ReactNode {
  const ciRuns = useQuery(ciRunQueries.list(project.id));
  const narrow = useNarrowToProject(project.id);
  return (
    <OverviewTile
      icon="activity"
      title="CI"
      link={
        <Link to="/work/ci" className="project-block-link" onClick={narrow}>
          CI runs
        </Link>
      }
      readings={[ciRuns]}
    >
      {() => {
        const listing = ciRuns.data?.projects.find(({ projectId }) => projectId === project.id);
        if (listing === undefined) {
          return <TileEmpty>CI runs need a code host The Office reads.</TileEmpty>;
        }
        const { onBaseBranch, newer } = newestCiRuns(
          ciRuns.data?.runs ?? [],
          project.id,
          project.baseBranch,
        );
        return (
          <>
            {listing.problem !== null && (
              <p className="project-block-error" role="alert">
                {ciRunProblemWords(listing.problem)}
              </p>
            )}
            {onBaseBranch === undefined && newer === undefined ? (
              <TileEmpty>No CI runs on {CI_CODE_HOST} yet.</TileEmpty>
            ) : (
              <ul className="project-overview-list">
                {onBaseBranch !== undefined && <CiRunRow run={onBaseBranch} />}
                {newer !== undefined && <CiRunRow run={newer} />}
              </ul>
            )}
            {listing.stale && <p className="project-block-note">Out of date</p>}
          </>
        );
      }}
    </OverviewTile>
  );
}

function CiRunRow({ run }: { readonly run: CiRun }): ReactNode {
  return (
    <li className="project-overview-ci-run">
      <span className="project-overview-row">
        <ToneBadge words={CI_RUN_STATUS_WORDS[run.status]} />
        <a href={run.url} target="_blank" rel="noreferrer" className="project-overview-name">
          {ciRunName(run)}
        </a>
      </span>
      <span className="project-overview-age">
        {run.branch ?? "no branch"} · {shortCommit(run.commit)} · {checkedWords(run.updatedAt)}
      </span>
    </li>
  );
}

/** The Project's open pull requests: how many, and the newest with their checks. */
export function PullRequestsTile({ project }: { readonly project: Project }): ReactNode {
  const pullRequests = useQuery(pullRequestQueries.list(project.id));
  const narrow = useNarrowToProject(project.id);
  return (
    <OverviewTile
      icon="git-pull-request"
      title="Pull requests"
      link={
        <Link to="/work/pull-requests" className="project-block-link" onClick={narrow}>
          Pull requests
        </Link>
      }
      readings={[pullRequests]}
    >
      {() => {
        const open = (pullRequests.data?.pullRequests ?? []).filter(
          ({ projectId }) => projectId === project.id,
        );
        const problems = (pullRequests.data?.problems ?? []).filter(
          ({ projectId }) => projectId === project.id,
        );
        return (
          <>
            {problems.map((problem) => (
              <p key={problem.kind} className="project-block-error" role="alert">
                {pullRequestProblemWords(problem)}
              </p>
            ))}
            {open.length === 0 ? (
              <TileEmpty>No open pull requests.</TileEmpty>
            ) : (
              <>
                <p className="project-overview-count">
                  <b>{open.length}</b> open
                </p>
                <ul className="project-overview-list">
                  {open.slice(0, NEWEST_PULL_REQUESTS).map((pullRequest) => (
                    <PullRequestRow key={pullRequest.id} pullRequest={pullRequest} />
                  ))}
                </ul>
              </>
            )}
          </>
        );
      }}
    </OverviewTile>
  );
}

function PullRequestRow({ pullRequest }: { readonly pullRequest: PullRequest }): ReactNode {
  return (
    <li className="project-overview-pull-request">
      <a href={pullRequest.url} target="_blank" rel="noreferrer" className="project-overview-name">
        {pullRequestName(pullRequest)}
      </a>
      <span className="project-overview-row">
        <ToneBadge words={CHECKS_WORDS[pullRequest.checks]} />
        <ToneBadge words={MERGEABLE_WORDS[pullRequest.mergeable]} />
        <Link
          to="/tasks/$taskId"
          params={{ taskId: pullRequest.taskId }}
          className="project-overview-age"
        >
          Its Task
        </Link>
      </span>
    </li>
  );
}

/**
 * What the base branch's remote needs of the Office identity and what of it is missing, with the
 * code host refusing to be read as the CI and pull request listings last found it.
 */
export function RemoteSignInTile({ project }: { readonly project: Project }): ReactNode {
  const remoteNeeds = useQuery(projectQueries.remoteNeeds(project.id));
  // Already read by the CI and Pull requests tiles; their problems say whether the host refuses.
  const ciRuns = useQuery(ciRunQueries.list(project.id));
  const pullRequests = useQuery(pullRequestQueries.list(project.id));
  return (
    <OverviewTile
      icon="key-round"
      title="Remote sign-in"
      link={
        <Link to={OFFICE_IDENTITY_SETTINGS_PATH} className="project-block-link">
          Settings › Office identity
        </Link>
      }
      readings={[remoteNeeds]}
    >
      {() => {
        if (remoteNeeds.data === null || remoteNeeds.data === undefined) {
          return (
            <TileEmpty>
              Its base branch tracks no remote branch, so it needs nothing of the Office identity.
            </TileEmpty>
          );
        }
        const signIn = remoteSignIn(
          remoteNeeds.data,
          ciRuns.data?.projects.find(({ projectId }) => projectId === project.id)?.problem,
          (pullRequests.data?.problems ?? []).filter(({ projectId }) => projectId === project.id),
        );
        return (
          <>
            <p className="project-overview-sign-in">
              {signIn.tone !== "neutral" && (
                <Badge tone={signIn.tone} dot size="sm">
                  {signIn.tone === "success" ? "Signed in" : "Needs attention"}
                </Badge>
              )}
              <span>{signIn.needs}</span>
            </p>
            {signIn.problems.map((problem) => (
              <p key={problem} className="project-overview-warning">
                {problem}
              </p>
            ))}
          </>
        );
      }}
    </OverviewTile>
  );
}
