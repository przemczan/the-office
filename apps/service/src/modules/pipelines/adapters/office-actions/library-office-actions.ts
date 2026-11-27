import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ADD_LIBRARY_PIPELINE_ACTION,
  ADD_STAGE_TEMPLATE_ACTION,
  APPLY_STAGE_TEMPLATE_ACTION,
  CHANGE_LIBRARY_PIPELINE_ACTION,
  CHANGE_STAGE_TEMPLATE_ACTION,
  COPY_LIBRARY_PIPELINE_ACTION,
  DELETE_LIBRARY_PIPELINE_ACTION,
  DELETE_STAGE_TEMPLATE_ACTION,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeActionSubjectSnapshot,
  type OfficeToolChangedField,
} from "../../../engine/index.js";
import { LinkedStages, type TemplateEditApplied } from "../../application/linked-stages.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import type { Pipeline } from "../../domain/pipeline.js";
import type { StageTemplate } from "../../domain/stage-template.js";
import { PipelineRepository } from "../../ports/pipeline-repository.js";
import { StageTemplateRepository } from "../../ports/stage-template-repository.js";
import { givenStage, withStagesGiven } from "../http/given-stages.js";
import {
  toLinkedStageResponse,
  toPipelineResponse,
  toStageTemplateResponse,
} from "../http/pipeline-responses.js";
import { answered } from "./answered.js";

type Snapshot = OfficeActionSubjectSnapshot;

/**
 * One of the library's Office actions as Pipelines carries it out: `handle` for the user's request,
 * an Agent's call and an applied Proposal alike, its result answered to the web by `response` and
 * worded to the Agent by `words`, and `snapshot` the record it acts on as it is now, for the
 * Proposal's draft. `goesAway` lists what a deletion takes with it, which the draft shows, and
 * `gives` the new name an add gives, which a draft leaves out as its subject's id.
 */
interface LibraryActionHandler<Action extends OfficeAction, Outcome> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>): Promise<Outcome>;
  response(outcome: Outcome): unknown;
  words(outcome: Outcome, input: z.output<Action["input"]>): string;
  snapshot(input: z.output<Action["input"]>): Promise<Snapshot>;
  goesAway?(input: z.output<Action["input"]>): Promise<Record<string, unknown>>;
  /** What the call gives that the draft would leave out, as the subject's own id: a new name. */
  gives?(input: z.output<Action["input"]>): Record<string, string>;
}

type AnyHandler = LibraryActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Outcome>(
  each: LibraryActionHandler<Action, Outcome>,
): AnyHandler {
  return each as unknown as AnyHandler;
}

/**
 * The office-wide Pipelines' and Stage templates' Office actions (the Office action convention):
 * the one handler of each, which the route (`PipelinesOfficeActionsController`, through
 * `PipelinesOfficeActions.answer`) and the Office tool, registered here, both call. Each draft
 * fingerprints the record's whole content now, so a change made since the draft means the record
 * changed. Throws at start for a declared action with no handler.
 */
@Injectable()
export class LibraryOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly editor: PipelineLibraryEditor,
    private readonly templateEditor: StageTemplateLibraryEditor,
    private readonly linkedStages: LinkedStages,
    private readonly pipelines: PipelineRepository,
    private readonly templates: StageTemplateRepository,
  ) {
    this.handlers = new Map(this.makeHandlers().map((each) => [each.action.name, each]));
  }

  /** Whether the action is one of the library's. */
  carriesOut(action: OfficeAction): boolean {
    return LIBRARY_ACTIONS.some(({ name }) => name === action.name);
  }

  onModuleInit(): void {
    for (const action of LIBRARY_ACTIONS) {
      const each = this.handlers.get(action.name);
      if (!each) throw new Error(`The library carries out no Office action ${action.name}.`);
      const apply = (input: Record<string, unknown>) =>
        answered(async () => each.words(await each.handle(input), input));
      this.registry.register(
        officeActionTool(action, (input) => apply(input), {
          draft: (input) => this.draftOf(each, input),
          applyFor: (input) => apply(input),
        }),
      );
    }
  }

  /** The route's answer to the action. */
  async answer(action: OfficeAction, input: unknown): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`The library carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as Record<string, unknown>));
  }

  private async draftOf(each: AnyHandler, input: Record<string, unknown>) {
    const draft = officeActionDraft(each.action, input, await each.snapshot(input));
    const given = Object.entries(each.gives?.(input) ?? {}).map(([label, value]) =>
      shownField(label, null, value),
    );
    const gone = Object.entries((await each.goesAway?.(input)) ?? {}).map(([label, value]) =>
      shownField(label, typeof value === "string" ? value : JSON.stringify(value), null),
    );
    return { ...draft, fields: [...given, ...draft.fields, ...gone] };
  }

  private makeHandlers(): readonly AnyHandler[] {
    return [
      handler({
        action: ADD_LIBRARY_PIPELINE_ACTION,
        handle: (input) => this.editor.add(withStagesGiven(input)),
        response: toPipelineResponse,
        words: ({ name, id }) => `The Pipeline "${name}" is added, id ${id}.`,
        gives: ({ name }) => ({ name: name.trim() }),
        snapshot: async ({ name }) => ({
          title: name.trim(),
          decidedBy: { nameTaken: await this.pipelineNameTaken(name) },
          values: {},
        }),
      }),
      handler({
        action: COPY_LIBRARY_PIPELINE_ACTION,
        handle: ({ copyOf }) => this.editor.copy(copyOf),
        response: toPipelineResponse,
        words: ({ name, id }) => `The Pipeline "${name}" is made as a copy, id ${id}.`,
        snapshot: ({ copyOf }) => this.pipelineSnapshot(copyOf),
      }),
      handler({
        action: CHANGE_LIBRARY_PIPELINE_ACTION,
        handle: ({ pipelineId, ...edit }) => this.editor.save(pipelineId, withStagesGiven(edit)),
        response: toPipelineResponse,
        words: ({ name }) => `The Pipeline "${name}" is saved as given.`,
        snapshot: ({ pipelineId }) => this.pipelineSnapshot(pipelineId),
      }),
      handler({
        action: DELETE_LIBRARY_PIPELINE_ACTION,
        handle: ({ pipelineId }) => this.editor.remove(pipelineId),
        response: () => undefined,
        words: () => "The Pipeline is deleted.",
        snapshot: ({ pipelineId }) => this.pipelineSnapshot(pipelineId),
        goesAway: async ({ pipelineId }) => {
          const pipeline = await this.pipelines.find(pipelineId);
          if (!pipeline) return {};
          const { name, description, stages } = toPipelineResponse(pipeline);
          return { name, description, stages };
        },
      }),
      handler({
        action: ADD_STAGE_TEMPLATE_ACTION,
        handle: ({ stage }) => this.templateEditor.add(givenStage(stage)),
        response: toStageTemplateResponse,
        words: ({ stage, id }) => `The Stage template "${stage.name}" is added, id ${id}.`,
        snapshot: async ({ stage }) => ({
          title: stage.name.trim(),
          decidedBy: { nameTaken: await this.templateNameTaken(stage.name) },
          values: {},
        }),
      }),
      handler({
        action: CHANGE_STAGE_TEMPLATE_ACTION,
        handle: ({ templateId, stage }) => this.templateEditor.save(templateId, givenStage(stage)),
        response: toStageTemplateResponse,
        words: ({ stage }) => `The Stage template "${stage.name}" is saved as given.`,
        snapshot: ({ templateId }) => this.templateSnapshot(templateId),
      }),
      handler({
        action: APPLY_STAGE_TEMPLATE_ACTION,
        handle: ({ templateId, fields, stages }) =>
          this.linkedStages.apply(templateId, fields, stages),
        response: ({ applied, refused }: TemplateEditApplied) => ({
          applied,
          refused: refused.map((pipeline) => ({ ...pipeline, reasons: [...pipeline.reasons] })),
        }),
        words: appliedWords,
        snapshot: async ({ templateId, stages }) => {
          const snapshot = await this.templateSnapshot(templateId);
          if (snapshot.decidedBy.exists !== true) return snapshot;
          const linked = (await this.linkedStages.list(templateId))
            .filter(({ pipelineId, stage }) =>
              stages.some((ref) => ref.pipelineId === pipelineId && ref.stageKey === stage.key),
            )
            .map(toLinkedStageResponse);
          return { ...snapshot, decidedBy: { ...snapshot.decidedBy, linked } };
        },
      }),
      handler({
        action: DELETE_STAGE_TEMPLATE_ACTION,
        handle: ({ templateId }) => this.templateEditor.remove(templateId),
        response: () => undefined,
        words: () => "The Stage template is deleted.",
        snapshot: ({ templateId }) => this.templateSnapshot(templateId),
        goesAway: async ({ templateId }) => {
          const template = await this.templates.find(templateId);
          if (!template) return {};
          const { stage } = toStageTemplateResponse(template);
          const linked = await this.linkedStages.list(templateId);
          return { stage, linkedStages: linked.length };
        },
      }),
    ];
  }

  private async pipelineSnapshot(id: string): Promise<Snapshot> {
    const pipeline = await this.pipelines.find(id);
    return pipeline ? pipelineSnapshotOf(pipeline) : missing(id);
  }

  private async templateSnapshot(id: string): Promise<Snapshot> {
    const template = await this.templates.find(id);
    return template ? templateSnapshotOf(template) : missing(id);
  }

  private async pipelineNameTaken(name: string): Promise<boolean> {
    const wanted = name.trim().toLowerCase();
    return (await this.pipelines.list()).some((each) => each.name.trim().toLowerCase() === wanted);
  }

  private async templateNameTaken(name: string): Promise<boolean> {
    const wanted = name.trim().toLowerCase();
    return (await this.templates.list()).some(
      ({ stage }) => stage.name.trim().toLowerCase() === wanted,
    );
  }
}

const LIBRARY_ACTIONS: readonly OfficeAction[] = [
  ADD_LIBRARY_PIPELINE_ACTION,
  COPY_LIBRARY_PIPELINE_ACTION,
  CHANGE_LIBRARY_PIPELINE_ACTION,
  DELETE_LIBRARY_PIPELINE_ACTION,
  ADD_STAGE_TEMPLATE_ACTION,
  CHANGE_STAGE_TEMPLATE_ACTION,
  APPLY_STAGE_TEMPLATE_ACTION,
  DELETE_STAGE_TEMPLATE_ACTION,
];

/** A Pipeline as the draft shows and fingerprints it: its content now, the version a Proposal is from. */
function pipelineSnapshotOf(pipeline: Pipeline): Snapshot {
  const { id, name, description, stages, endPosition } = toPipelineResponse(pipeline);
  return {
    title: name,
    decidedBy: { exists: true, version: { id, name, description, stages, endPosition } },
    values: { name, description, stages, endPosition },
  };
}

/** A Stage template as the draft shows and fingerprints it. */
function templateSnapshotOf(template: StageTemplate): Snapshot {
  const { id, stage } = toStageTemplateResponse(template);
  return {
    title: stage.name,
    decidedBy: { exists: true, version: { id, stage } },
    values: { stage },
  };
}

function missing(id: string): Snapshot {
  return { title: id, decidedBy: { exists: false }, values: {} };
}

/** A field the draft shows apart from the input's own: its value now and the value after. */
function shownField(
  label: string,
  before: string | null,
  after: string | null,
): OfficeToolChangedField {
  const text = before ?? after ?? "";
  return {
    label:
      label.charAt(0).toUpperCase() +
      label
        .slice(1)
        .replaceAll(/([A-Z])/g, " $1")
        .toLowerCase(),
    before,
    after,
    form: text.includes("\n") || text.length > 80 ? "long" : "short",
  };
}

function appliedWords({ applied, refused }: TemplateEditApplied): string {
  const lines = [
    `The template's fields are applied to ${applied} Stage${applied === 1 ? "" : "s"}.`,
  ];
  for (const { pipelineName, reasons } of refused) {
    lines.push(
      `The Pipeline "${pipelineName}" was refused and keeps its Stages: ${reasons.join(" ")}`,
    );
  }
  return lines.join("\n");
}
