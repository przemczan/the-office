import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { SegmentedControl } from "@the-office/ui";
import type { ReactNode } from "react";
import { archivePeriodQuery } from "../../api/work.ts";
import { ArchivedInitiatives } from "./archived-initiatives.tsx";
import { ArchivedTasks } from "./archived-tasks.tsx";

const KINDS = [
  { value: "tasks", label: "Tasks" },
  { value: "initiatives", label: "Initiatives" },
] as const;

/** Work › Archived: the archived Tasks, or with `?kind=initiatives` the archived Initiatives. */
export function ArchivedPage(): ReactNode {
  const { kind } = useSearch({ from: "/work/archived" });
  const navigate = useNavigate();
  const archivePeriod = useQuery(archivePeriodQuery()).data?.archivePeriod;
  return (
    <div className="archived-page">
      <div className="archived-kind" role="group" aria-label="What is archived">
        <SegmentedControl
          size="sm"
          options={[...KINDS]}
          value={kind ?? "tasks"}
          onChange={(value) =>
            void navigate({
              to: "/work/archived",
              // The search, filter and page are the Initiatives archive's own.
              search: value === "initiatives" ? { kind: "initiatives" } : {},
            })
          }
        />
        {archivePeriod !== undefined && (
          <span className="archived-kind-hint">
            Done and Dropped ones leave the board {archivePeriod}{" "}
            {archivePeriod === 1 ? "day" : "days"} after they ended, or by Archive.
          </span>
        )}
      </div>
      {kind === "initiatives" ? <ArchivedInitiatives /> : <ArchivedTasks />}
    </div>
  );
}
