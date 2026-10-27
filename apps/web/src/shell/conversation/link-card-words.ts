import type { RunningTask } from "@the-office/contracts";

/**
 * What the person is on now, from the running Tasks Now shows: "Implement · Rename dialog",
 * "Waiting on you · Rename dialog", "2 Tasks · 1 waiting on you", or "Available".
 */
export function personStatus(roleKey: string, running: readonly RunningTask[]): string {
  const on = running.filter(({ stage }) => stage?.role === roleKey);
  const [only] = on;
  if (only && on.length === 1) return `${taskWords(only)} · ${only.title}`;
  if (on.length === 0) return "Available";
  const waiting = on.filter(({ state }) => state === "waiting-on-you").length;
  return waiting === 0 ? `${on.length} Tasks` : `${on.length} Tasks · ${waiting} waiting on you`;
}

function taskWords({ state, stage }: RunningTask): string {
  if (state === "waiting-on-you") return "Waiting on you";
  if (state === "paused") return "Paused";
  return stage?.name ?? "Starting";
}
