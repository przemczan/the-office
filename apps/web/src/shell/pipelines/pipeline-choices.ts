import type {
  DefaultPipelineOfKind,
  KindDefaultPipelines,
  Pipeline,
  ProjectPipeline,
  Stage,
  TaskKind,
} from "@the-office/contracts";
import { stagesLine } from "./pipeline-words.ts";

/** A Pipeline a picker offers, read the same whether it is office-wide or a Project Pipeline. */
export interface PipelineChoice {
  readonly id: string;
  readonly name: string;
  /** The Stages a Task on it gets. */
  readonly stages: readonly Stage[];
  /** Its second line: its Stages, and the Pipeline a Project Pipeline was copied from. */
  readonly line: string;
  /** Whether it is the Project's default, or its Task's Kind's, marked as such in a Task's picker. */
  readonly isDefault: boolean;
  /** The Kind it is the default for, where a Task's Kind chose it: "Default for Bugs". */
  readonly defaultFor?: TaskKind;
  /**
   * Why it can't be chosen: a Project Pipeline that was Broken before The Office updated and isn't
   * saved since, with its reasons; undefined when it can be.
   */
  readonly brokenWhy: string | undefined;
}

export interface PipelineChoiceGroup {
  readonly label: string;
  readonly choices: readonly PipelineChoice[];
}

/** What a picker needs of the Project: its name for the group and its default to mark. */
export interface ChoosingProject {
  readonly id: string;
  readonly name: string;
  readonly defaultPipeline: string;
  /** Each Kind's default, resolved: its own, else the Project's. */
  readonly defaultPipelineOfKind?: DefaultPipelineOfKind;
  /** Each Kind's own default, null where it follows the Project's. */
  readonly kindDefaultPipelines?: KindDefaultPipelines;
}

const OFFICE_WIDE_PIPELINES = "Office-wide Pipelines";

/**
 * A Task's choices (spec §2.3, "Project Pipelines"): its Project's own Pipelines, then the
 * office-wide ones, the Project's default first in its group and marked; one that was Broken
 * before The Office updated, not saved since, is listed with why and can't be chosen. Another
 * Project's Project Pipelines are never offered. Given the Task's Kind, its Kind's default is the
 * one first and marked: "Default for Bugs" when the Kind sets its own, the Project's default
 * otherwise.
 */
export function taskPipelineChoices(
  project: ChoosingProject,
  officeWide: readonly Pipeline[],
  projectPipelines: readonly ProjectPipeline[],
  kind?: TaskKind,
): PipelineChoiceGroup[] {
  const kindDefault = kind && project.defaultPipelineOfKind?.[kind];
  if (kind === undefined || kindDefault === undefined) {
    return grouped(project, officeWide, projectPipelines, { marksDefault: true });
  }
  const kindHasItsOwn = (project.kindDefaultPipelines?.[kind] ?? null) !== null;
  return grouped({ ...project, defaultPipeline: kindDefault }, officeWide, projectPipelines, {
    marksDefault: true,
    ...(kindHasItsOwn && { defaultFor: kind }),
  });
}

/** The Pipeline a Task's picker opens on: its marked default, unless that one can't be chosen. */
export function openingChoice(groups: readonly PipelineChoiceGroup[]): PipelineChoice | undefined {
  return groups
    .flatMap(({ choices }) => choices)
    .find(({ isDefault, brokenWhy }) => isDefault && brokenWhy === undefined);
}

/** A Project's default's choices: its own Pipelines, then the office-wide ones, none marked. */
export function defaultPipelineChoices(
  project: ChoosingProject,
  officeWide: readonly Pipeline[],
  projectPipelines: readonly ProjectPipeline[],
): PipelineChoiceGroup[] {
  return grouped(project, officeWide, projectPipelines, { marksDefault: false });
}

export function choiceById(
  groups: readonly PipelineChoiceGroup[],
  id: string | null,
): PipelineChoice | undefined {
  return groups.flatMap(({ choices }) => choices).find((choice) => choice.id === id);
}

/**
 * Why a Project Pipeline that was Broken before The Office updated can't be chosen, in the picker's
 * words; undefined for one that can be.
 */
export function brokenWords(
  projectPipeline: ProjectPipeline,
  projectName: string,
): string | undefined {
  const reasons = projectPipeline.brokenBeforeUpdate;
  if (reasons === null) return undefined;
  return `Broken before The Office updated: ${reasons.join(" ")} Save it once in ${projectName}'s Pipelines to choose it.`;
}

function grouped(
  project: ChoosingProject,
  officeWide: readonly Pipeline[],
  projectPipelines: readonly ProjectPipeline[],
  { marksDefault, defaultFor }: { readonly marksDefault: boolean; readonly defaultFor?: TaskKind },
): PipelineChoiceGroup[] {
  const marked = (choice: PipelineChoice): PipelineChoice => {
    const isDefault = marksDefault && choice.id === project.defaultPipeline;
    return { ...choice, isDefault, ...(isDefault && defaultFor && { defaultFor }) };
  };
  const own = projectPipelines
    .filter(({ projectId }) => projectId === project.id)
    .map((projectPipeline) => projectPipelineChoice(projectPipeline, project.name));
  const groups: PipelineChoiceGroup[] = [
    {
      label: `${project.name}'s Pipelines`,
      choices: defaultFirst(own, project.defaultPipeline).map(marked),
    },
    {
      label: OFFICE_WIDE_PIPELINES,
      choices: defaultFirst(officeWide.map(officeWideChoice), project.defaultPipeline).map(marked),
    },
  ];
  return groups.filter(({ choices }) => choices.length > 0);
}

function defaultFirst(
  choices: readonly PipelineChoice[],
  defaultPipelineId: string,
): PipelineChoice[] {
  const isDefault = ({ id }: PipelineChoice): boolean => id === defaultPipelineId;
  return [...choices.filter(isDefault), ...choices.filter((choice) => !isDefault(choice))];
}

function officeWideChoice(pipeline: Pipeline): PipelineChoice {
  return {
    id: pipeline.id,
    name: pipeline.name,
    stages: pipeline.stages,
    line: stagesLine(pipeline),
    isDefault: false,
    brokenWhy: undefined,
  };
}

function projectPipelineChoice(
  projectPipeline: ProjectPipeline,
  projectName: string,
): PipelineChoice {
  return {
    id: projectPipeline.id,
    name: projectPipeline.name,
    stages: projectPipeline.stages,
    line: `${stagesLine(projectPipeline)} · copied from ${projectPipeline.copiedFrom.name}`,
    isDefault: false,
    brokenWhy: brokenWords(projectPipeline, projectName),
  };
}
