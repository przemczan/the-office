import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RepositoryClone } from "@the-office/contracts";
import { Alert, Input, ProgressBar } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries, startRepositoryClone } from "../../api/projects.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";

export type ClonedRepository = Extract<RepositoryClone, { state: "cloned" }>;

/** The repository clone Add a Project starts, read live from its events once started. */
export interface RepositoryCloning {
  readonly start: (url: string) => void;
  /** Why the service refused to start it: every reason, nothing cloned. */
  readonly refusal: Error | null;
  readonly clone: RepositoryClone | undefined;
  readonly busy: boolean;
  readonly forget: () => void;
}

export function useRepositoryCloning(): RepositoryCloning {
  const [cloneId, setCloneId] = useState<string>();
  const queryClient = useQueryClient();
  const starting = useMutation({
    mutationFn: startRepositoryClone,
    onSuccess: async (clone) => {
      const query = projectQueries.repositoryClone(clone.id);
      queryClient.setQueryData(query.queryKey, clone);
      setCloneId(clone.id);
      // Its events may have come before the query was there to refresh.
      await queryClient.invalidateQueries(query);
    },
  });
  const clone = useQuery({
    ...projectQueries.repositoryClone(cloneId ?? ""),
    enabled: cloneId !== undefined,
  });
  const current = cloneId === undefined ? undefined : clone.data;
  return {
    start: (url) => starting.mutate(url),
    refusal: starting.error,
    clone: current,
    busy: starting.isPending || current?.state === "cloning",
    forget: () => {
      starting.reset();
      setCloneId(undefined);
    },
  };
}

/** "Where it is" as a git URL: the Repository URL to clone, and how its clone is going. */
export function RepositoryCloneStep({
  formId,
  cloning,
  children,
}: {
  readonly formId: string;
  readonly cloning: RepositoryCloning;
  /** What comes first in the form: the choice of where the repository is. */
  readonly children: ReactNode;
}): ReactNode {
  const [url, setUrl] = useState("");
  return (
    <form
      id={formId}
      className="add-project-form"
      onSubmit={(event) => {
        event.preventDefault();
        cloning.start(url.trim());
      }}
    >
      {children}
      <CloneProblems cloning={cloning} />
      <Input
        label="Repository URL"
        hint="https, ssh:// or user@host:path. The Office clones it into its data folder, then you add it."
        placeholder="https://github.com/owner/repository.git"
        value={url}
        disabled={cloning.busy}
        onChange={(event) => setUrl(event.target.value)}
        inputStyle={{ fontFamily: "var(--font-mono)" }}
        autoFocus
      />
      <CloneProgress cloning={cloning} />
    </form>
  );
}

/** Why the clone couldn't start, or why it failed; nothing while it goes well. */
export function CloneProblems({ cloning }: { readonly cloning: RepositoryCloning }): ReactNode {
  const { clone } = cloning;
  return (
    <>
      {cloning.refusal && (
        <RefusalAlert title="The repository can't be cloned" error={cloning.refusal} />
      )}
      {clone?.state === "failed" && (
        <Alert tone="danger" title="The clone failed">
          {clone.problem}
        </Alert>
      )}
    </>
  );
}

/** How far the clone has come, while it runs. */
export function CloneProgress({ cloning }: { readonly cloning: RepositoryCloning }): ReactNode {
  const { clone } = cloning;
  if (clone?.state !== "cloning") return null;
  const percent = clone.progress?.percent;
  return (
    <ProgressBar
      value={percent ?? 0}
      label={clone.progress?.phase ?? "Starting the clone"}
      valueLabel={percent === undefined ? "" : `${percent}%`}
      size="sm"
    />
  );
}

/** The repository's name in its URL, which the Project is named after until the user changes it. */
export function repositoryNameOf(url: string): string {
  const last = url.replace(/\/+$/, "").split(/[/:]/).at(-1) ?? "";
  return last.replace(/\.git$/, "");
}
