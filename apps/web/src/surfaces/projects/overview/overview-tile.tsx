import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../../api/projects.ts";
import { onlyProject } from "../../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../../shell/project-filter/use-project-filter.ts";
import { ProjectBlock } from "../project-block.tsx";

/** What a tile reads, as a query answers it: still loading, failed, or there. */
export interface TileReading {
  readonly isPending: boolean;
  readonly error: Error | null;
}

/**
 * One tile of the Overview's grid: a Project block with its link at the title's end, a skeleton
 * while any of its readings loads and its own error line when one fails, so the other tiles stay.
 * Its content renders only once every reading is there.
 */
export function OverviewTile({
  icon,
  title,
  link,
  wide = false,
  readings,
  children,
}: {
  readonly icon: string;
  readonly title: string;
  readonly link: ReactNode;
  /** Two columns wide when the pane fits two. */
  readonly wide?: boolean;
  readonly readings: readonly TileReading[];
  readonly children: () => ReactNode;
}): ReactNode {
  const error = readings.find((reading) => reading.error !== null)?.error ?? null;
  const loading = readings.some((reading) => reading.isPending);
  return (
    <div className={wide ? "project-overview-tile wide" : "project-overview-tile"}>
      <ProjectBlock icon={icon} title={title} actions={link}>
        {error !== null ? (
          <p className="project-block-error" role="alert">
            {error.message}
          </p>
        ) : loading ? (
          <div className="project-overview-loading" aria-busy="true">
            <Skeleton height={14} />
            <Skeleton height={14} width="70%" />
          </div>
        ) : (
          children()
        )}
      </ProjectBlock>
    </div>
  );
}

/** A tile's empty state. */
export function TileEmpty({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="project-overview-empty">{children}</p>;
}

/**
 * A link's click that narrows the project filter to this Project before Work opens, so the tab it
 * goes to shows this Project's records only.
 */
export function useNarrowToProject(projectId: string): () => void {
  const projects = useQuery(projectQueries.list());
  const { choose } = useProjectFilter();
  return () =>
    choose(
      onlyProject(
        projectId,
        (projects.data ?? []).map(({ id }) => id),
      ),
    );
}
