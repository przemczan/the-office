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
  /** The Repository URL being started or cloned, or the one the clone shown was of. */
  readonly url: string | undefined;
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
    // Followed here rather than in the mutation's own onSuccess, which runs even after `forget`
    // reset it: a clone the user moved away from never takes over the dialog. A failed one before it
    // goes as the next starts.
    start: (url) => {
      setCloneId(undefined);
      starting.mutate(url, { onSuccess: (started) => setCloneId(started.id) });
    },
    refusal: starting.error,
    clone: current,
    url: starting.isPending ? starting.variables : current?.url,
    busy: starting.isPending || current?.state === "cloning",
    forget: () => {
      starting.reset();
      setCloneId(undefined);
    },
  };
}

/**
 * Step 1 of Add a Project by a git URL: the Repository URL, cloned on the form's submit (the bar's
 * Clone), and how its clone is going. `url` is the dialog's, so Change finds it as it was.
 */
export function RepositoryCloneStep({
  formId,
  cloning,
  url,
  onUrlChange,
}: {
  readonly formId: string;
  readonly cloning: RepositoryCloning;
  readonly url: string;
  readonly onUrlChange: (url: string) => void;
}): ReactNode {
  const [missing, setMissing] = useState(false);
  return (
    <form
      id={formId}
      className="add-project-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = url.trim();
        setMissing(trimmed === "");
        if (trimmed !== "") cloning.start(trimmed);
      }}
    >
      <CloneRefusal cloning={cloning} />
      {cloning.clone?.state === "failed" && (
        <Alert tone="danger" title="The clone failed">
          {cloning.clone.problem}
        </Alert>
      )}
      <Input
        label="Repository URL"
        hint="https, ssh:// or user@host:path. The Office clones it into its data folder."
        error={missing ? "Write the repository's git URL." : undefined}
        placeholder="https://github.com/owner/repository.git"
        value={url}
        disabled={cloning.busy}
        onChange={(event) => onUrlChange(event.target.value)}
        inputStyle={{ fontFamily: "var(--font-mono)" }}
        spellCheck={false}
        autoFocus
      />
      <CloneProgress cloning={cloning} />
    </form>
  );
}

/** Why the service refused to start the clone; nothing while none was refused. */
export function CloneRefusal({ cloning }: { readonly cloning: RepositoryCloning }): ReactNode {
  return (
    cloning.refusal && (
      <RefusalAlert title="The repository can't be cloned" error={cloning.refusal} />
    )
  );
}

/** How far the clone has come, from the moment it is asked for until it ends. */
export function CloneProgress({ cloning }: { readonly cloning: RepositoryCloning }): ReactNode {
  if (!cloning.busy) return null;
  const { clone } = cloning;
  const progress = clone?.state === "cloning" ? clone.progress : undefined;
  const percent = progress?.percent;
  return (
    <ProgressBar
      value={percent ?? 0}
      label={progress?.phase ?? "Starting the clone"}
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
