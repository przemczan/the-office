import type { WorkRecordSource } from "./work-records.js";

/** Work's records when Work knows none: a test spreads it and gives only what it reads. */
export const NO_WORK_RECORDS: WorkRecordSource = {
  taskRecord: () => Promise.resolve(undefined),
  taskTitle: () => Promise.resolve(undefined),
  taskSubjects: () => Promise.resolve(new Map()),
  taskAttachmentIds: () => Promise.resolve([]),
  initiativeTaskAttachmentIds: () => Promise.resolve(undefined),
  initiativeRecord: () => Promise.resolve(undefined),
  initiativeName: () => Promise.resolve(undefined),
  projectWork: () => Promise.resolve({ taskIds: [], initiativeIds: [] }),
  ideaRecord: () => Promise.resolve(undefined),
};

/** Every Task Work is asked about is there, titled and in the Project as given. */
export function taskSubjectsAs(title: string, projectId: string): WorkRecordSource["taskSubjects"] {
  return (taskIds) => Promise.resolve(new Map(taskIds.map((id) => [id, { title, projectId }])));
}
