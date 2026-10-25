import type { Author } from "./author.js";
import { titleProblem } from "./title.js";

/** Shaped is an Idea that became a Task (an Initiative in tier 2), which names it as its origin. */
export type IdeaState = "new" | "shaped" | "dropped";

/** A thought captured quickly and not yet shaped into work (spec §2.1). */
export interface Idea {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  /** Undefined for an Idea captured Office-wide. */
  readonly projectId: string | undefined;
  readonly state: IdeaState;
  readonly capturedBy: Author;
  readonly capturedAt: Date;
  /** When it was dropped, kept so a dropped Idea reads as one; undefined unless dropped. */
  readonly droppedAt: Date | undefined;
}

/** What capturing an Idea takes; the rest is set by The Office. */
export type NewIdea = Pick<Idea, "title" | "notes" | "projectId">;

export function trimmedNewIdea(idea: NewIdea): NewIdea {
  return { title: idea.title.trim(), notes: idea.notes.trim(), projectId: idea.projectId };
}

/** Why a new Idea can't be captured; that its Project exists is checked by the caller. */
export function newIdeaProblems(idea: NewIdea): string[] {
  const problem = titleProblem(idea.title, "Idea");
  return problem ? [problem] : [];
}
