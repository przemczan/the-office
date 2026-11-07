import type { GitHubRepository, Project } from "@the-office/contracts";
import { clockOf, dayOf, sameDay } from "../../shell/time.ts";

/** A repository as Add a Project lists it: the Project it was already added as, if any. */
export interface RepositoryRow {
  readonly repository: GitHubRepository;
  readonly owner: string;
  readonly name: string;
  /** The Project whose Repository URL is this repository's; it can't be picked again. */
  readonly addedAs: string | undefined;
}

/**
 * Recent first: every repository that matches the search, the most recently pushed on top, those
 * already added as a Project at the end, since they can't be picked and are usually pushed last.
 */
export function repositoryRowsOf(
  repositories: readonly GitHubRepository[],
  projects: readonly Pick<Project, "name" | "repositoryUrl">[],
  search: string,
): RepositoryRow[] {
  const projectsByRepository = new Map(
    projects.flatMap((project) =>
      project.repositoryUrl === null
        ? []
        : [[repositoryKeyOf(project.repositoryUrl), project.name]],
    ),
  );
  const query = search.trim().toLowerCase();
  return repositories
    .map((repository) => {
      const [owner = "", name = repository.fullName] = repository.fullName.split("/");
      const addedAs = projectsByRepository.get(repositoryKeyOf(repository.repositoryUrl));
      return { repository, owner, name, addedAs };
    })
    .filter(
      (row) =>
        query === "" ||
        [row.name, row.owner, row.repository.description].some((text) =>
          text.toLowerCase().includes(query),
        ),
    )
    .toSorted(
      (a, b) =>
        Number(a.addedAs !== undefined) - Number(b.addedAs !== undefined) ||
        pushedTime(b.repository) - pushedTime(a.repository),
    );
}

/** Never pushed sorts last. */
function pushedTime(repository: GitHubRepository): number {
  return repository.pushedAt === null ? 0 : Date.parse(repository.pushedAt);
}

/**
 * A Repository URL as one key whatever its form: https, ssh:// or user@host:path, with or without
 * `.git`, so a Project cloned by its ssh URL still marks the repository GitHub lists by https.
 */
export function repositoryKeyOf(url: string): string {
  return (
    url
      .trim()
      .toLowerCase()
      .replace(/^[a-z+]+:\/\//, "")
      .replace(/^[^@/]+@/, "")
      // The host's port, or scp-like `host:owner/name`, both become `host/`.
      .replace(/^([^/:]+):(\d+\/)?/, "$1/")
      .replace(/\/+$/, "")
      .replace(/\.git$/, "")
  );
}

/** The text split around the search's first match, to mark it; undefined when it doesn't match. */
export function matchIn(
  text: string,
  search: string,
): readonly [before: string, match: string, after: string] | undefined {
  const query = search.trim().toLowerCase();
  const at = query === "" ? -1 : text.toLowerCase().indexOf(query);
  if (at < 0) return undefined;
  return [text.slice(0, at), text.slice(at, at + query.length), text.slice(at + query.length)];
}

/** "pushed today at 14:02", "pushed yesterday", "pushed 25 Oct"; "never pushed" without a time. */
export function pushedWords(pushedAt: string | null, now: Date = new Date()): string {
  if (pushedAt === null) return "never pushed";
  if (sameDay(pushedAt, now)) return `pushed today at ${clockOf(pushedAt)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(pushedAt, yesterday)) return "pushed yesterday";
  return `pushed ${dayOf(pushedAt, now)}`;
}
