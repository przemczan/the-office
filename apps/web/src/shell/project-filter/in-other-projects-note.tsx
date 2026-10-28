import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { inOtherProjectsWords } from "./project-filter-choices.ts";
import { useProjectFilter } from "./use-project-filter.ts";

/**
 * How many more the Project filter leaves out, opening them all with "Show all projects"; nothing
 * when none are.
 */
export function InOtherProjectsNote({
  count,
  one,
  many,
}: {
  readonly count: number;
  /** What is counted, as one and as many: "Task", "Tasks". */
  readonly one: string;
  readonly many: string;
}): ReactNode {
  const { showAllProjects } = useProjectFilter();
  if (count === 0) return null;
  return (
    <button type="button" className="in-other-projects-note" onClick={showAllProjects}>
      <Icon name="eye-off" size={14} />
      {inOtherProjectsWords(count, one, many)}
      <span className="shell-grow" />
      <span className="in-other-projects-show">Show all projects</span>
    </button>
  );
}
