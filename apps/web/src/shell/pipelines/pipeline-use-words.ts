import type { PipelineUse } from "@the-office/contracts";

/**
 * Who uses a library Pipeline, as the click-through words it: "Default for Admin panel · 2 not
 * started Tasks use it · 1 running Task keeps the copy it started with · 1 Initiative names it".
 */
export function pipelineUseLine({
  defaultFor,
  notStarted,
  running,
  initiatives,
}: PipelineUse): string {
  const defaults =
    defaultFor.length === 0 ? "no Project" : defaultFor.map(({ name }) => name).join(", ");
  const naming = `${initiatives} ${initiatives === 1 ? "Initiative names" : "Initiatives name"} it`;
  return `Default for ${defaults} · ${tasksLine(notStarted, running)} · ${naming}`;
}

/**
 * Who uses a Project Pipeline, beside its Project's default, which its head names apart: "2 not
 * started Tasks use it · 1 running Task keeps the copy it started with". No Initiative names one.
 */
export function projectPipelineUseLine({ notStarted, running }: PipelineUse): string {
  return tasksLine(notStarted, running);
}

function tasksLine(notStarted: number, running: number): string {
  const upcoming = `${notStarted} not started ${notStarted === 1 ? "Task uses" : "Tasks use"} it`;
  const keeping =
    running === 1
      ? "1 running Task keeps the copy it started with"
      : `${running} running Tasks keep the copy they started with`;
  return `${upcoming} · ${keeping}`;
}
