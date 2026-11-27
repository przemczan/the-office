import type {
  OfficeCommit as OfficeCommitResponse,
  OfficeReleaseNote,
  OfficeUpdate,
  OfficeUpdateResult as OfficeUpdateResultResponse,
  OfficeUpdateTarget as OfficeUpdateTargetResponse,
} from "@the-office/contracts";
import { OfficeRestarts } from "../../application/office-restarts.js";
import { OfficeUpdates, type OfficeUpdateView } from "../../application/office-updates.js";
import { shortCommit, type OfficeCommit } from "../../domain/office-commit.js";
import type { OfficeUpdateResult } from "../../domain/office-update-result.js";
import type { OfficeUpdateTarget } from "../../domain/office-update-target.js";
import type { PublishedRelease } from "../../domain/published-release.js";

/** Settings › Updates as the web reads it: the update's view with the restart's refusal. */
export async function officeUpdateResponse(
  updates: OfficeUpdates,
  restarts: OfficeRestarts,
): Promise<OfficeUpdate> {
  const [view, restartRefusal] = await Promise.all([updates.view(), restarts.refusal()]);
  return toOfficeUpdate(view, restartRefusal);
}

function toOfficeUpdate(
  { install, version, current, check, refusal, checking, scheduled, lastResult }: OfficeUpdateView,
  restartRefusal: string | undefined,
): OfficeUpdate {
  return {
    install,
    ...(version && { version }),
    current: toCommit(current),
    ...(check && {
      check: {
        checkedAt: check.checkedAt.toISOString(),
        ...(check.newest && { newest: toCommit(check.newest) }),
        behind: check.behind.map(toCommit),
        releases: check.releases.map(toReleaseNote),
        ...(check.problem && { problem: check.problem }),
      },
    }),
    ...(refusal && { refusal }),
    restart: { ...(restartRefusal && { refusal: restartRefusal }) },
    checking,
    ...(scheduled && { scheduled: toScheduled(scheduled) }),
    ...(lastResult && { lastResult: toResult(lastResult) }),
  };
}

function toScheduled(
  scheduled: NonNullable<OfficeUpdateView["scheduled"]>,
): NonNullable<OfficeUpdate["scheduled"]> {
  const shared = {
    scheduledAt: scheduled.scheduledAt.toISOString(),
    busy: scheduled.busy.map(({ kind, label }) => ({ kind, label })),
  };
  return scheduled.kind === "update"
    ? { kind: "update", target: toTarget(scheduled.target), ...shared }
    : { kind: "restart", ...shared };
}

function toCommit({ commit, subject, committedAt }: OfficeCommit): OfficeCommitResponse {
  return {
    commit,
    shortCommit: shortCommit(commit),
    subject,
    committedAt: committedAt.toISOString(),
  };
}

function toReleaseNote({
  version,
  name,
  publishedAt,
  notes,
  url,
}: PublishedRelease): OfficeReleaseNote {
  return { version, name, publishedAt: publishedAt.toISOString(), notes, url };
}

function toTarget(target: OfficeUpdateTarget): OfficeUpdateTargetResponse {
  if (target.kind === "commit") return { kind: "commit", ...toCommit(target) };
  const { version, name, publishedAt, url } = target;
  return { kind: "release", version, name, publishedAt: publishedAt.toISOString(), url };
}

function toResult(result: OfficeUpdateResult): OfficeUpdateResultResponse {
  return { ...result, finishedAt: result.finishedAt.toISOString() };
}
