import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GitHubPermission } from "@the-office/contracts";
import { Alert, Button } from "@the-office/ui";
import type { ReactNode } from "react";
import { checkGitHubPermissions, gitHubQueries } from "../api/github.ts";
import { RefusalAlert } from "./refusal-alert.tsx";

/** The names GitHub's permission settings show where they aren't the API's name in words. */
const SHOWN_NAMES: Readonly<Record<string, string>> = { statuses: "Commit statuses" };

/**
 * "Checks (read)", "Pull requests (write)": a permission as GitHub's settings name it, and its
 * level.
 */
export function permissionWords({ name, level }: GitHubPermission): string {
  const words = SHOWN_NAMES[name] ?? name.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} (${level})`;
}

/**
 * What the GitHub App lacks, read from GitHub: the permissions to add on the App's settings, a link
 * per installation to accept them on, and Check again, which reads them again and puts the answer
 * in Sign in with GitHub's query. Nothing while every installation has them, or while signed out.
 * Settings › Office identity, Work › Pull requests and CI show it; the GitHub issues block and the
 * Import issues window only while `needing` is among the missing (docs/design/issues-as-tasks.html).
 */
export function GitHubPermissionsPrompt({
  needing,
}: {
  /** Shown only while this permission, by its API name such as "issues", is missing. */
  readonly needing?: string;
} = {}): ReactNode {
  const state = useQuery(gitHubQueries.state());
  const queryClient = useQueryClient();
  const checking = useMutation({
    mutationFn: checkGitHubPermissions,
    onSuccess: (answer) => queryClient.setQueryData(gitHubQueries.state().queryKey, answer),
  });
  const permissions = state.data?.status === "signed-in" ? state.data.permissions : null;
  if (permissions === null) return null;
  if (needing !== undefined && !permissions.missing.some(({ name }) => name === needing)) {
    return null;
  }
  return (
    <div className="github-permissions-prompt">
      <Alert
        tone="warning"
        title="The GitHub App needs more permissions"
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={checking.isPending}
            onClick={() => checking.mutate()}
          >
            Check again
          </Button>
        }
      >
        <p>
          Without them The Office can&apos;t read every pull request&apos;s checks or merge state,
          or import, comment on and close issues. Missing:
        </p>
        <ul className="github-permissions-missing">
          {permissions.missing.map((permission) => (
            <li key={permission.name}>{permissionWords(permission)}</li>
          ))}
        </ul>
        <p>
          <a href={permissions.appPermissionsUrl} target="_blank" rel="noopener noreferrer">
            Add them to the App on GitHub
          </a>
        </p>
        {permissions.installations.length > 0 && (
          <p className="github-permissions-installations">
            <span>Accept on each installation:</span>
            {permissions.installations.map(({ account, acceptUrl }) => (
              <a key={acceptUrl} href={acceptUrl} target="_blank" rel="noopener noreferrer">
                {account}
              </a>
            ))}
          </p>
        )}
      </Alert>
      {checking.error && (
        <RefusalAlert title="The permissions weren't checked" error={checking.error} />
      )}
    </div>
  );
}
