import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  OFFICE_IDENTITY_SETTINGS_PATH,
  type GitHubRepository,
  type GitHubState,
} from "@the-office/contracts";
import { Badge, Button, Icon, Input } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { gitHubQueries } from "../../api/github.ts";
import { projectQueries } from "../../api/projects.ts";
import { BlockLoader } from "../../shell/block-loader.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useClock } from "../../shell/use-clock.ts";
import {
  matchIn,
  pushedWords,
  repositoryRowsOf,
  type RepositoryRow,
} from "./github-repository-words.ts";
import { CloneProgress, CloneRefusal, type RepositoryCloning } from "./repository-clone-step.tsx";

/**
 * Starts reading the repositories as Add a Project opens, while signed in, so the list is usually
 * there by the time From GitHub is chosen.
 */
export function useGitHubRepositoriesEarly(): void {
  const gitHub = useQuery(gitHubQueries.state());
  useQuery({ ...gitHubQueries.repositories(), enabled: gitHub.data?.status === "signed-in" });
}

/**
 * Step 1 of Add a Project from GitHub: the repositories the App is installed on, Recent first.
 * Picking one clones it by its Repository URL, as a typed git URL is.
 */
export function GitHubRepositoryPicker({
  cloning,
  onPick,
  onUseGitUrl,
}: {
  readonly cloning: RepositoryCloning;
  readonly onPick: (repository: GitHubRepository) => void;
  /** Leaves GitHub for "A git URL", when GitHub can't be used. */
  readonly onUseGitUrl: () => void;
}): ReactNode {
  const gitHub = useQuery(gitHubQueries.state());
  if (gitHub.error) {
    return <RefusalAlert title="Sign in with GitHub can't be read" error={gitHub.error} />;
  }
  if (gitHub.data && gitHub.data.status !== "signed-in") {
    return <SignInFirst state={gitHub.data} onUseGitUrl={onUseGitUrl} />;
  }
  return (
    <RepositoryList cloning={cloning} installUrl={gitHub.data?.app.installUrl} onPick={onPick} />
  );
}

/** One block in place of the search and the list: what to do first, and a way around it. */
function SignInFirst({
  state,
  onUseGitUrl,
}: {
  readonly state: Exclude<GitHubState, { status: "signed-in" }>;
  readonly onUseGitUrl: () => void;
}): ReactNode {
  const notRegistered = state.status === "not-registered";
  const titleId = useId();
  return (
    <section className="github-sign-in" aria-labelledby={titleId}>
      <Icon name="github" size={28} />
      <h3 id={titleId}>
        {notRegistered ? "Register the GitHub App first" : "Sign in with GitHub first"}
      </h3>
      <p>
        {notRegistered
          ? "The Office needs its own GitHub App before it can list your repositories. Register it and sign in"
          : "Sign in with GitHub"}{" "}
        in Settings › Office identity, then the repositories the App is installed on show here.
      </p>
      <div className="github-sign-in-actions">
        <Link className="link-button" to={OFFICE_IDENTITY_SETTINGS_PATH}>
          Open Settings › Office identity
        </Link>
        <Button variant="ghost" onClick={onUseGitUrl}>
          Use a git URL instead
        </Button>
      </div>
    </section>
  );
}

function RepositoryList({
  cloning,
  installUrl,
  onPick,
}: {
  readonly cloning: RepositoryCloning;
  /** Unknown until Sign in with GitHub is read. */
  readonly installUrl: string | undefined;
  readonly onPick: (repository: GitHubRepository) => void;
}): ReactNode {
  const gitHub = useQuery(gitHubQueries.state());
  const repositories = useQuery({
    ...gitHubQueries.repositories(),
    enabled: gitHub.data?.status === "signed-in",
  });
  const projects = useQuery(projectQueries.list());
  const [search, setSearch] = useState("");
  const titleId = useId();
  const now = useClock();
  const all = repositories.data;
  // Which are already added comes from the Projects, so the list waits for them too, and fails with
  // them rather than loading for ever.
  const loaded = all !== undefined && projects.data !== undefined;
  const failure = repositories.error ?? projects.error;
  const retry = (): void => {
    if (repositories.error) void repositories.refetch();
    if (projects.error) void projects.refetch();
  };
  const rows = loaded ? repositoryRowsOf(all, projects.data, search) : [];
  const count = loaded
    ? search.trim() === ""
      ? `${all.length}`
      : `${rows.length} of ${all.length}`
    : undefined;
  return (
    <div className="github-repositories-step">
      <CloneRefusal cloning={cloning} />
      <Input
        type="search"
        aria-label="Search your repositories"
        placeholder="Search by name, owner or description"
        iconLeft={<Icon name="search" size={15} />}
        value={search}
        disabled={cloning.busy}
        onChange={(event) => setSearch(event.target.value)}
        autoFocus
      />
      <section className="github-repositories" aria-labelledby={titleId}>
        <header className="github-repositories-head">
          <h3 id={titleId} className="github-repositories-title">
            Your repositories
            {count && <span className="github-repositories-count">{count}</span>}
          </h3>
        </header>
        {failure ? (
          <div className="github-repositories-failed">
            <RefusalAlert
              title={
                repositories.error
                  ? "GitHub's repositories can't be listed"
                  : "Your Projects can't be read"
              }
              error={failure}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={repositories.isFetching || projects.isFetching}
                  onClick={retry}
                >
                  Try again
                </Button>
              }
            />
          </div>
        ) : !loaded ? (
          <div className="github-repositories-rows">
            <BlockLoader shape="rows" label="Loading your repositories…" />
          </div>
        ) : all.length === 0 ? (
          <div className="github-repositories-empty">
            <strong>The App is installed on no repository you can reach yet.</strong>
            <span>Install it on the repositories The Office may clone, and they show here.</span>
            {installUrl && (
              <a className="link-button" href={installUrl} target="_blank" rel="noreferrer">
                Install the App on GitHub
                <Icon name="external-link" size={13} />
              </a>
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="github-repositories-empty">
            <strong>No repository matches “{search.trim()}”.</strong>
            <span>The search looks at every repository's name, owner and description.</span>
          </div>
        ) : (
          <ul className="github-repositories-rows" aria-label="Your GitHub repositories">
            {rows.map((row, index) => (
              <RepositoryItem
                key={row.repository.fullName}
                row={row}
                firstAdded={row.addedAs !== undefined && rows[index - 1]?.addedAs === undefined}
                search={search}
                now={now}
                cloning={cloning}
                onPick={() => onPick(row.repository)}
              />
            ))}
          </ul>
        )}
        {installUrl && loaded && all.length > 0 && (
          <footer className="github-repositories-foot">
            Missing one?{" "}
            <a href={installUrl} target="_blank" rel="noreferrer">
              Install the App on more repositories
            </a>
          </footer>
        )}
      </section>
    </div>
  );
}

/** A repository's row: to pick, cloning, failed, or already added and not to be picked. */
function RepositoryItem({
  row,
  firstAdded,
  search,
  now,
  cloning,
  onPick,
}: {
  readonly row: RepositoryRow;
  /** The first already added, under which the label "Already added" goes. */
  readonly firstAdded: boolean;
  readonly search: string;
  readonly now: Date;
  readonly cloning: RepositoryCloning;
  readonly onPick: () => void;
}): ReactNode {
  const { repository, addedAs } = row;
  const detailsId = useId();
  const ofThisRow = cloning.url === repository.repositoryUrl;
  const failed = ofThisRow && cloning.clone?.state === "failed" ? cloning.clone : undefined;
  const state =
    addedAs !== undefined
      ? "added"
      : ofThisRow && cloning.busy
        ? "cloning"
        : failed
          ? "failed"
          : "to-pick";
  const words = (
    <span className="github-repository-words">
      <span className="github-repository-name">
        <Marked text={row.name} search={search} />
      </span>
      <span className="github-repository-line" id={detailsId}>
        <Marked text={row.owner} search={search} /> ·{" "}
        <span className="github-repository-branch">{repository.defaultBranch}</span> ·{" "}
        {pushedWords(repository.pushedAt, now)}
      </span>
      {state === "added" ? (
        <span className="github-repository-description">
          Already added, as the Project {addedAs}.
        </span>
      ) : state === "cloning" ? (
        <CloneProgress cloning={cloning} />
      ) : failed ? (
        <span className="github-repository-problem" role="alert">
          The clone failed: {failed.problem}
        </span>
      ) : (
        repository.description !== "" && (
          <span className="github-repository-description" title={repository.description}>
            <Marked text={repository.description} search={search} />
          </span>
        )
      )}
    </span>
  );
  const icon = (
    <span className="github-repository-icon" aria-hidden="true">
      <Icon name="book-marked" size={15} />
    </span>
  );
  const privateBadge = repository.private && <Badge tone="neutral">Private</Badge>;
  return (
    <>
      {firstAdded && (
        <li className="github-repositories-group" aria-hidden="true">
          Already added
        </li>
      )}
      <li className="github-repositories-row">
        {state === "to-pick" ? (
          <button
            type="button"
            className="github-repository"
            aria-label={repository.fullName}
            aria-describedby={detailsId}
            title={`Clone ${repository.repositoryUrl}`}
            disabled={cloning.busy}
            onClick={onPick}
          >
            {icon}
            {words}
            <span className="github-repository-aside">
              <span className="github-repository-clone-hint" aria-hidden="true">
                Clone
              </span>
              {privateBadge}
            </span>
          </button>
        ) : (
          <div
            className={`github-repository ${state}`}
            role="group"
            aria-label={repository.fullName}
            aria-busy={state === "cloning"}
          >
            {icon}
            {words}
            <span className="github-repository-aside">
              {privateBadge}
              {state === "added" && <Badge tone="neutral">Added</Badge>}
              {state === "failed" && (
                <Button variant="secondary" size="sm" onClick={onPick}>
                  Try again
                </Button>
              )}
            </span>
          </div>
        )}
      </li>
    </>
  );
}

/** The text with the search's match marked. */
function Marked({ text, search }: { readonly text: string; readonly search: string }): ReactNode {
  const match = matchIn(text, search);
  if (!match) return text;
  const [before, marked, after] = match;
  return (
    <>
      {before}
      <mark>{marked}</mark>
      {after}
    </>
  );
}
