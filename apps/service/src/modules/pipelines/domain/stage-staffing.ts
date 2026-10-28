import { problemOnStage, type StageProblem } from "./pipeline.js";
import type { Stage } from "./stage.js";
/** Who fills a Role named on an Agent Stage, as the Stage editor's flags need it. */
export interface RoleFilling {
  /** The Role's title, such as Devops. */
  readonly title: string;
  /** Undefined when nobody fills the Role: never hired, or let go. */
  readonly person:
    | {
        readonly name: string;
        /** "none" when the person only talks and no Pipeline may name the Role (spec §2.2). */
        readonly taskLimit: number | "none";
      }
    | undefined;
  /** The name of the person who filled the Role before they were let go, if anyone did. */
  readonly letGoPerson?: string;
}

/**
 * Agent Stages whose Role nobody can work, from `fromIndex` on: Stages before it have started and
 * keep whoever worked them, so a person let go since never blocks an edit the user can't fix.
 */
export function staffingProblems(
  stages: readonly Stage[],
  fromIndex: number,
  roles: ReadonlyMap<string, RoleFilling>,
): StageProblem[] {
  return problemsOnAgentStages(
    stages,
    fromIndex,
    roles,
    (filling) => vacancyProblem(filling) ?? talkOnlyProblem(filling),
  );
}

function problemsOnAgentStages(
  stages: readonly Stage[],
  fromIndex: number,
  roles: ReadonlyMap<string, RoleFilling>,
  problemOf: (filling: RoleFilling) => string | undefined,
): StageProblem[] {
  return stages.flatMap((stage, stageIndex) => {
    if (stageIndex < fromIndex || stage.kind !== "agent" || stage.role.trim() === "") return [];
    const problem = problemOf(roles.get(stage.role) ?? { title: stage.role, person: undefined });
    return problem ? [problemOnStage(stage, stageIndex, problem)] : [];
  });
}

function vacancyProblem({ title, person, letGoPerson }: RoleFilling): string | undefined {
  if (person) return undefined;
  if (letGoPerson) {
    return `${letGoPerson} was let go from ${title}; hire ${letGoPerson} back, hire someone else, or choose who works it.`;
  }
  return `nobody fills ${title}; hire someone or choose who works it.`;
}

function talkOnlyProblem({ title, person }: RoleFilling): string | undefined {
  return person?.taskLimit === "none"
    ? `${person.name}'s Task limit is none, so ${title} only talks and can't work a Stage.`
    : undefined;
}
