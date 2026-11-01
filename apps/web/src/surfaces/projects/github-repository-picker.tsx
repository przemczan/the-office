import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  OFFICE_IDENTITY_SETTINGS_PATH,
  type GitHubRepository,
  type GitHubState,
} from "@the-office/contracts";
import { Badge, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { gitHubQueries } from "../../api/github.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { CloneProblems, CloneProgress, type RepositoryCloning } from "./repository-clone-step.tsx";

/**
 * "Where it is" from GitHub: the repositories the App is installed on, searched by name. Picking
 * one clones it by its Repository URL, as a typed git URL is.
 */
export function GitHubRepositoryPicker({
  cloning,
  children,
}: {
  readonly cloning: RepositoryCloning;
  /** What comes first: the choice of where the repository is. */
  readonly children: ReactNode;
}): ReactNode {
  const gitHub = useQuery(gitHubQueries.state());
  return (
    <div className="add-project-form">
      {children}
      {gitHub.error && (
        <RefusalAlert title="Sign in with GitHub can't be read" error={gitHub.error} />
      )}
      {gitHub.data?.status === "signed-in" ? (
        <RepositoryList cloning={cloning} installUrl={gitHub.data.app.installUrl} />
      ) : (
        gitHub.data && <SignInFirst state={gitHub.data} />
      )}
    </div>
  );
}

function SignInFirst({ state }: { readonly state: GitHubState }): ReactNode {
  const first =
    state.status === "not-registered"
      ? "Register the GitHub App and sign in"
      : "Sign in with GitHub";
  return (
    <p className="add-project-note">
      {first} in <Link to={OFFICE_IDENTITY_SETTINGS_PATH}>Settings › Office identity</Link> to pick
      one of the repositories the App is installed on.
    </p>
  );
}

function RepositoryList({
  cloning,
  installUrl,
}: {
  readonly cloning: RepositoryCloning;
  readonly installUrl: string;
}): ReactNode {
  const repositories = useQuery(gitHubQueries.repositories());
  const [search, setSearch] = useState("");
  const found = (repositories.data ?? []).filter((repository) =>
    repository.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <CloneProblems cloning={cloning} />
      {repositories.error && (
        <RefusalAlert title="GitHub's repositories can't be listed" error={repositories.error} />
      )}
      <Input
        type="search"
        label="Search your repositories"
        placeholder="owner/repository"
        value={search}
        disabled={cloning.busy}
        onChange={(event) => setSearch(event.target.value)}
        autoFocus
      />
      <CloneProgress cloning={cloning} />
      {repositories.data && (
        <ul className="github-repositories" aria-label="Your GitHub repositories">
          {found.map((repository) => (
            <RepositoryItem
              key={repository.fullName}
              repository={repository}
              disabled={cloning.busy}
              onPick={() => cloning.start(repository.repositoryUrl)}
            />
          ))}
        </ul>
      )}
      {repositories.data && found.length === 0 && (
        <p className="add-project-note">
          {repositories.data.length === 0
            ? "The App is installed on no repository you can reach yet."
            : "No repository matches."}{" "}
          <a href={installUrl} target="_blank" rel="noreferrer">
            Install the App on more repositories
          </a>
        </p>
      )}
    </>
  );
}

function RepositoryItem({
  repository,
  disabled,
  onPick,
}: {
  readonly repository: GitHubRepository;
  readonly disabled: boolean;
  readonly onPick: () => void;
}): ReactNode {
  return (
    <li>
      <button
        type="button"
        className="github-repository"
        title={`Clone ${repository.repositoryUrl}`}
        disabled={disabled}
        onClick={onPick}
      >
        <span className="github-repository-name">{repository.fullName}</span>
        {repository.private && <Badge tone="neutral">Private</Badge>}
        <span className="github-repository-branch">{repository.defaultBranch}</span>
      </button>
    </li>
  );
}
