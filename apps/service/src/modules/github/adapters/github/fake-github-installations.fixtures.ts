/** A repository on the fake GitHub, by `owner/name`. */
export interface FakeRepository {
  readonly fullName: string;
  readonly private?: boolean;
}

interface Installation {
  readonly id: number;
  readonly account: string;
  readonly repositories: readonly FakeRepository[];
  readonly suspended: boolean;
}

/** An answer of the fake's REST API: a status, a JSON body and the headers beside it. */
export interface ApiAnswer {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/** GitHub's page size when none is asked for, and the most it gives. */
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/**
 * The App's installations on the fake GitHub, and the REST API listing them and their repositories
 * for a user token (docs.github.com/rest/apps/installations): `per_page` and `page`, and a `Link`
 * header with the other pages' absolute URLs, left out when everything fits on one page.
 */
export class FakeInstallations {
  private readonly installations: Installation[] = [];

  /**
   * `web` is GitHub's website, where the repositories' pages are; `git` is where their clone URLs
   * are, GitHub's website too unless a test serves the repositories elsewhere.
   */
  constructor(
    private readonly web: string,
    private readonly git: string = web,
  ) {}

  /** The App installed on `account`'s repositories; a suspended installation is listed but can't be reached. */
  install(
    account: string,
    repositories: readonly FakeRepository[],
    { suspended = false }: { suspended?: boolean } = {},
  ): void {
    this.installations.push({
      id: 100 + this.installations.length,
      account,
      repositories,
      suspended,
    });
  }

  /** Whether a user token reaches the repository: an installation that isn't suspended holds it. */
  reaches(fullName: string): boolean {
    return this.installations.some(
      (installation) =>
        !installation.suspended &&
        installation.repositories.some(
          (repository) => repository.fullName.toLowerCase() === fullName.toLowerCase(),
        ),
    );
  }

  /** `GET /user/installations`, `request` being the URL under the API's base. */
  listInstallations(request: URL): ApiAnswer {
    return this.page(request, "installations", this.installations, (installation) => ({
      id: installation.id,
      account: { login: installation.account, type: "User" },
      repository_selection: "selected",
      app_slug: "the-office-fake-1",
      target_type: "User",
      html_url: `${this.web}/settings/installations/${installation.id}`,
      suspended_at: installation.suspended ? "2026-01-01T00:00:00Z" : null,
    }));
  }

  /** `GET /user/installations/{installation_id}/repositories`. */
  listRepositories(request: URL, installationId: number): ApiAnswer {
    const installation = this.installations.find(({ id }) => id === installationId);
    if (installation === undefined) return { status: 404, body: { message: "Not Found" } };
    if (installation.suspended) {
      // Undocumented what GitHub answers for a suspended installation; its docs list 403.
      return { status: 403, body: { message: "This installation has been suspended" } };
    }
    return this.page(request, "repositories", installation.repositories, (repository) => {
      const [owner = "", name = ""] = repository.fullName.split("/");
      return {
        id: 1,
        name,
        full_name: repository.fullName,
        private: repository.private ?? false,
        owner: { login: owner, type: "User" },
        html_url: `${this.web}/${repository.fullName}`,
        clone_url: `${this.git}/${repository.fullName}.git`,
        default_branch: "main",
      };
    });
  }

  private page<T>(
    request: URL,
    key: string,
    all: readonly T[],
    toJson: (item: T) => unknown,
  ): ApiAnswer {
    const size = Math.min(
      Number(request.searchParams.get("per_page") ?? DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const number = Number(request.searchParams.get("page") ?? 1);
    const items = all.slice((number - 1) * size, number * size).map(toJson);
    const last = Math.max(1, Math.ceil(all.length / size));
    const body = { total_count: all.length, [key]: items };
    if (last === 1) return { status: 200, body };
    const linkTo = (page: number, rel: string): string => {
      const url = new URL(request);
      url.searchParams.set("page", String(page));
      return `<${url.href}>; rel="${rel}"`;
    };
    const links = [
      ...(number > 1 ? [linkTo(number - 1, "prev")] : []),
      ...(number < last ? [linkTo(number + 1, "next"), linkTo(last, "last")] : []),
      ...(number > 1 ? [linkTo(1, "first")] : []),
    ];
    return { status: 200, body, headers: { link: links.join(", ") } };
  }
}
