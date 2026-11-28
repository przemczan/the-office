import {
  activityItemSchema,
  subjectActivitySchema,
  type Activity as ActivityResponse,
  type ActivityItem as ActivityItemResponse,
  type SubjectActivity as SubjectActivityResponse,
} from "@the-office/contracts";
import type { Activity, ActivityItem, SubjectActivity } from "../../domain/activity.js";

export function toActivityResponse({ activities, otherWork, count }: Activity): ActivityResponse {
  return {
    activities: activities.map(toSubjectActivityResponse),
    otherWork: otherWork.map(toActivityItemResponse),
    count,
  };
}

/** Parsed, as the domain keeps the owning modules' states as plain strings. */
function toSubjectActivityResponse(activity: SubjectActivity): SubjectActivityResponse {
  return subjectActivitySchema.parse({
    id: activity.id,
    subject: {
      ...activity.subject,
      ...("initiativeId" in activity.subject
        ? { initiativeId: activity.subject.initiativeId ?? null }
        : {}),
    },
    link: activity.link,
    since: activity.since.toISOString(),
    sessions: activity.sessions.map((session) => ({
      threadId: session.threadId ?? null,
      person:
        session.roleKey === undefined
          ? { kind: "the-office" }
          : { kind: "person", roleKey: session.roleKey },
      sessionKind: session.sessionKind,
      stageName: session.stageName ?? null,
      state: session.state,
      waitingOn: session.waitingOn
        ? { kind: session.waitingOn.kind, question: session.waitingOn.question ?? null }
        : null,
      since: session.since.toISOString(),
    })),
  });
}

/**
 * Parsed, as the domain keeps the owning modules' states as plain strings, each one of the
 * contracts' as the owning module answers it.
 */
function toActivityItemResponse(item: ActivityItem): ActivityItemResponse {
  return activityItemSchema.parse({ ...item, since: item.since.toISOString() });
}
