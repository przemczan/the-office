import { DUTIES, type DutyKey } from "../../people/index.js";
import { problemOnStage, type StageProblem } from "./pipeline.js";
import type { StageRun } from "./stage-run.js";
import { stageWorker, type AgentStage, type Stage, type StageWorker } from "./stage.js";

/** Who fills a Role or holds a duty named on an Agent Stage, as the Stage editor's flags need it. */
export interface RoleFilling {
  /** The Role's title, such as Devops; for a duty, its holder's Role's, or the duty's label. */
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
  /** The duty the Stage names, when it names one rather than a Role. */
  readonly duty?: { readonly label: string };
}

/** Who fills what Agent Stages name, by `fillingKey`. */
export type RoleFillingsByWorker = ReadonlyMap<string, RoleFilling>;

/**
 * Where `RoleFillingsByWorker` keeps who fills what a Stage names: a Role by its key, a duty apart,
 * as no Role key holds a colon.
 */
export function fillingKey(worker: StageWorker): string {
  return "role" in worker ? worker.role : `duty:${worker.duty}`;
}

/** The duty's label, such as Implements. */
export function dutyLabel(duty: DutyKey): string {
  return DUTIES.find(({ key }) => key === duty)?.label ?? duty;
}

/**
 * The Stages with each Agent Stage naming a duty given the Role that works it (spec §2.3): the Role
 * of its latest run among `runs`, so a started Stage keeps its person; else the duty's holder in
 * `holders` now; else none, and it stays unstaffed. Its duty is kept, for the words naming it.
 */
export function staffedStages(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  holders: ReadonlyMap<DutyKey, string>,
): Stage[] {
  return stages.map((stage) => {
    if (stage.kind !== "agent" || stage.duty === undefined || namesRole(stage)) return stage;
    const roleKey =
      runs.findLast((run) => run.stageKey === stage.key && run.roleKey !== undefined)?.roleKey ??
      holders.get(stage.duty);
    return roleKey === undefined ? stage : { ...stage, role: roleKey };
  });
}

/** The duties Agent Stages among `stages` name, each once, to read their holders for. */
export function dutiesToStaff(stages: readonly Stage[]): DutyKey[] {
  return [
    ...new Set(
      stages.flatMap((stage) =>
        stage.kind === "agent" && stage.duty !== undefined ? [stage.duty] : [],
      ),
    ),
  ];
}

/**
 * The Role a staffed Agent Stage runs as. Undefined for a Stage naming a duty nobody held when
 * `staffedStages` read it.
 */
export function staffedRole(stage: AgentStage): string | undefined {
  return namesRole(stage) ? stage.role : undefined;
}

/** Why an Agent Stage the walk reached has nobody to run as: its duty is unheld. */
export function unstaffedWords(stage: AgentStage): string {
  return stage.duty === undefined
    ? `Nobody is chosen to work the Stage ${stage.name}: choose who works it.`
    : `Nobody holds ${dutyLabel(stage.duty)}, which this Stage needs: choose who in Settings › Duties, or choose who works it.`;
}

function namesRole(stage: AgentStage): stage is AgentStage & { readonly role: string } {
  return stage.role !== undefined && stage.role.trim() !== "";
}

/**
 * Agent Stages whose Role or duty nobody can work, from `fromIndex` on: Stages before it have
 * started and keep whoever worked them, so a person let go since never blocks an edit the user
 * can't fix.
 */
export function staffingProblems(
  stages: readonly Stage[],
  fromIndex: number,
  fillings: RoleFillingsByWorker,
): StageProblem[] {
  return stages.flatMap((stage, stageIndex) => {
    const problem = stageIndex < fromIndex ? undefined : stageStaffingProblem(stage, fillings);
    return problem ? [problemOnStage(stage, stageIndex, problem)] : [];
  });
}

/** Why nobody can work the Stage, when it is an Agent Stage naming a Role or a duty. */
export function stageStaffingProblem(
  stage: Stage,
  fillings: RoleFillingsByWorker,
): string | undefined {
  const worker = stageWorker(stage);
  if (!worker) return undefined;
  const found = fillings.get(fillingKey(worker)) ?? unfilled(worker);
  // A staffed Stage names its holder's Role, and its words still name the duty.
  const filling =
    stage.kind === "agent" && stage.duty !== undefined
      ? { ...found, duty: { label: dutyLabel(stage.duty) } }
      : found;
  return vacancyProblem(filling) ?? talkOnlyProblem(filling);
}

function unfilled(worker: StageWorker): RoleFilling {
  return "role" in worker
    ? { title: worker.role, person: undefined }
    : { title: dutyLabel(worker.duty), person: undefined, duty: { label: dutyLabel(worker.duty) } };
}

function vacancyProblem({ title, person, letGoPerson, duty }: RoleFilling): string | undefined {
  if (person) return undefined;
  if (duty && letGoPerson) {
    return `${letGoPerson} was let go from ${title}, who holds ${duty.label}; hire ${letGoPerson} back, choose who holds it in Settings › Duties, or choose who works it.`;
  }
  if (duty) {
    return `nobody holds ${duty.label}; choose who in Settings › Duties, or choose who works it.`;
  }
  if (letGoPerson) {
    return `${letGoPerson} was let go from ${title}; hire ${letGoPerson} back, hire someone else, or choose who works it.`;
  }
  return `nobody fills ${title}; hire someone or choose who works it.`;
}

function talkOnlyProblem({ title, person, duty }: RoleFilling): string | undefined {
  if (person?.taskLimit !== "none") return undefined;
  return duty
    ? `${person.name} holds ${duty.label}, but their Task limit is none, so ${title} only talks and can't work a Stage; choose who holds it in Settings › Duties, or choose who works it.`
    : `${person.name}'s Task limit is none, so ${title} only talks and can't work a Stage.`;
}
