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
  return stages.flatMap((stage, stageIndex) => {
    if (stageIndex < fromIndex || stage.kind !== "agent" || stage.role.trim() === "") return [];
    const problem = fillingProblem(
      roles.get(stage.role) ?? { title: stage.role, person: undefined },
    );
    return problem ? [problemOnStage(stage, stageIndex, problem)] : [];
  });
}

function fillingProblem({ title, person }: RoleFilling): string | undefined {
  if (!person) return `nobody fills ${title}; hire someone or choose who works it.`;
  if (person.taskLimit === "none") {
    return `${person.name}'s Task limit is none, so ${title} only talks and can't work a Stage.`;
  }
  return undefined;
}
