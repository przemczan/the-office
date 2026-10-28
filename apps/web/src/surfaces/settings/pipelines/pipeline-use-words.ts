import type { PipelineUse } from "@the-office/contracts";

/**
 * Who uses a library Pipeline, as the click-through words it: "Default for Admin panel · 2 not
 * started Tasks use it · 1 running Task keeps the copy it started with".
 */
export function pipelineUseLine({ defaultFor, notStarted, running }: PipelineUse): string {
  const defaults =
    defaultFor.length === 0 ? "no Project" : defaultFor.map(({ name }) => name).join(", ");
  const upcoming = `${notStarted} not started ${notStarted === 1 ? "Task uses" : "Tasks use"} it`;
  const keeping =
    running === 1
      ? "1 running Task keeps the copy it started with"
      : `${running} running Tasks keep the copy they started with`;
  return `Default for ${defaults} · ${upcoming} · ${keeping}`;
}
