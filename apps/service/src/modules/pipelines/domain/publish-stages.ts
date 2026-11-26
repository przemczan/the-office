import type { GridStage } from "./flow.js";
import {
  RESOLVE_BUDGET_ABOVE,
  RESOLVE_TEMPLATE_BRIEF,
  RESOLVE_TEMPLATE_ID,
  RESOLVE_TEMPLATE_NAME,
} from "./resolve-template.js";
import {
  ENDED_FAILED,
  isFailureRoute,
  plainRoute,
  type ConditionGroup,
  type Route,
  type StagePlace,
} from "./route.js";
import {
  PUBLISH_COMMAND,
  type AgentStage,
  type Gate,
  type PublishStage,
  type PublishTarget,
  type ScriptStage,
  type Stage,
} from "./stage.js";

/**
 * A Publish Stage as the releases before Publish was a kind of its own kept it: a Script Stage
 * running `publish`, with what it did after a conflict. Stored Pipelines, Task's Stages and
 * Proposals still carry it, as they are never rewritten; `withPublishStages` reads it.
 */
export type KeptPublishStage = ScriptStage & {
  readonly publishTarget?: PublishTarget;
  /** Publish automatically once the conflict is resolved and tested, or wait at a Gate first. */
  readonly afterConflict?: "publish" | "review";
};

/**
 * The keys of the conflict chain's Stages the conversion draws in (spec §2.3.5, "The move to routes
 * back and Publish Stages"): those The Office put in before the chain was the Pipeline's own, so
 * the runs of a Task that was in it replay onto them. Their `office:` prefix is one no Stage the
 * editor names takes. A second Publish in the Pipeline gets them with `-2`, a third `-3`.
 */
export const RESOLVE_KEY = "office:resolve";
export const RESOLVE_TEST_KEY = "office:resolve-test";
export const RESOLVE_GATE_KEY = "office:resolve-gate";

/** How many times Publish's Conflict route leads to Resolve. */
export const CONFLICT_ROUTE_LIMIT = 3;

/** The Project command the Test after Resolve runs. */
export const RESOLVE_TEST_COMMAND = "test";

/** How many times a failing Test after Resolve goes back to Resolve. */
const RESOLVE_TEST_LIMIT = 2;

/** The condition of a Publish Stage's Conflict route: it ended Conflict. */
export const ENDED_CONFLICT: ConditionGroup = {
  combine: "all",
  tests: [{ kind: "stage", stage: null, is: "conflict" }],
};

/**
 * `stages` with each kept Script `publish` Stage read as a Publish Stage, keeping its key, name,
 * place, target, routes and template link, and the conflict chain drawn in for it when it publishes
 * by the publishing mode in a Pipeline with an Agent Stage (spec §2.3.5): a Conflict route to
 * Resolve after its failure routes, then Resolve, Test after Resolve and, where it asked for a
 * review after a conflict, the Gate, on a new row under it in the columns before its own. A Stage
 * already of the Publish kind is as it is, so a chain the user removed stays removed and reading
 * twice changes nothing. Only `asFlow` calls it, as the stored data stays as it is.
 */
export function withPublishStages(stages: readonly GridStage[]): GridStage[] {
  let flow: GridStage[] = stages.map(asPublishStage);
  const agentStages = flow.filter(
    (stage): stage is GridStage<AgentStage> => stage.kind === "agent",
  );
  const [firstAgentStage] = agentStages;
  // Of the Pipeline's own Agent Stages, never a Resolve drawn for an earlier Publish.
  const largestBudget = Math.max(...agentStages.map(({ budget }) => budget));
  for (const kept of stages) {
    if (isKeptPublishStage(kept) && kept.publishTarget !== "branch-only" && firstAgentStage) {
      flow = withConflictChain(flow, kept, { person: firstAgentStage, largestBudget });
    }
  }
  return flow;
}

/** Who works a drawn Resolve, and the largest budget its own is above. */
interface ResolveWorker {
  readonly person: GridStage<AgentStage>;
  readonly largestBudget: number;
}

function isKeptPublishStage(stage: Stage): stage is KeptPublishStage & GridStage {
  return stage.kind === "script" && stage.command === PUBLISH_COMMAND;
}

function asPublishStage(stage: GridStage): GridStage {
  if (!isKeptPublishStage(stage)) return stage;
  const {
    kind: _kind,
    command: _command,
    publishTarget,
    afterConflict: _afterConflict,
    ...fields
  } = stage;
  const publish: GridStage<PublishStage> = {
    ...fields,
    kind: "publish",
    ...(publishTarget === undefined ? {} : { publishTarget }),
  };
  return publish;
}

/** `flow` with the conflict chain for the Publish `kept` drawn in. */
function withConflictChain(
  flow: readonly GridStage[],
  kept: KeptPublishStage & GridStage,
  worker: ResolveWorker,
): GridStage[] {
  const chain = chainStages(flow, kept, worker);
  const [resolve] = chain;
  if (!resolve) return [...flow];
  const placed = withRoomBefore(flow, kept.key, chain.length);
  const publishPlace = placed.find(({ key }) => key === kept.key)?.place ?? kept.place;
  const firstColumn = publishPlace.column - chain.length;
  const row = 1 + Math.max(...rowsIn(placed, firstColumn, publishPlace.column));
  const drawn = chain.map((stage, index): GridStage => ({
    ...stage,
    place: { column: firstColumn + index, row },
  }));
  const conflictRoute: Route = {
    to: resolve.key,
    toName: resolve.name,
    condition: ENDED_CONFLICT,
    limit: CONFLICT_ROUTE_LIMIT,
  };
  // The chain goes just before its Publish in the Pipeline's order too, as readers that keep
  // the stored order (the library, a Task's Stages) see it as the walk does.
  return placed.flatMap((stage): GridStage[] => {
    if (stage.key !== kept.key) return [stage];
    const failureRoutes = stage.routes.filter((route) => isFailureRoute(route, stage.key)).length;
    return [
      ...drawn,
      { ...stage, routes: stage.routes.toSpliced(failureRoutes, 0, conflictRoute) },
    ];
  });
}

/** Resolve, Test after Resolve and, where the Publish asked for a review, the Gate, routed in a chain. */
function chainStages(
  flow: readonly GridStage[],
  publish: KeptPublishStage & GridStage,
  { person, largestBudget }: ResolveWorker,
): readonly GridStage[] {
  const taken = new Set(flow.map(({ key }) => key));
  const keyOf = (key: string): string => freeKey(key, taken);
  const resolveKey = keyOf(RESOLVE_KEY);
  const testKey = keyOf(RESOLVE_TEST_KEY);
  const gateKey = publish.afterConflict === "review" ? keyOf(RESOLVE_GATE_KEY) : undefined;
  const testName = "Test after Resolve";
  const gateName = "Review the resolved conflict";
  const afterTest = gateKey ?? publish.key;
  // Each is placed as the chain is drawn.
  const unplaced: StagePlace = { column: 0, row: 0 };
  const resolve: GridStage<AgentStage> = {
    kind: "agent",
    key: resolveKey,
    name: RESOLVE_TEMPLATE_NAME,
    optional: false,
    // Whoever works the first Agent Stage: its Role, or its duty, or both once the walk staffed it.
    ...(person.role === undefined ? {} : { role: person.role }),
    ...(person.duty === undefined ? {} : { duty: person.duty }),
    brief: RESOLVE_TEMPLATE_BRIEF,
    session: "fresh",
    budget: largestBudget + RESOLVE_BUDGET_ABOVE,
    mergeBaseFirst: true,
    templateId: RESOLVE_TEMPLATE_ID,
    routes: [{ ...plainRoute(testKey), toName: testName }],
    place: unplaced,
  };
  const test: GridStage<ScriptStage> = {
    kind: "script",
    key: testKey,
    name: testName,
    optional: false,
    command: RESOLVE_TEST_COMMAND,
    routes: [
      { to: resolveKey, toName: resolve.name, condition: ENDED_FAILED, limit: RESOLVE_TEST_LIMIT },
      { ...plainRoute(afterTest), toName: gateKey === undefined ? publish.name : gateName },
    ],
    place: unplaced,
  };
  if (gateKey === undefined) return [resolve, test];
  const gate: GridStage<Gate> = {
    kind: "gate",
    key: gateKey,
    name: gateName,
    optional: false,
    routes: [{ ...plainRoute(publish.key), toName: publish.name }],
    place: unplaced,
  };
  return [resolve, test, gate];
}

/** `key`, or with `-2`, `-3`… the first that no Stage takes; it is taken then. */
function freeKey(key: string, taken: Set<string>): string {
  let free = key;
  for (let count = 2; taken.has(free); count += 1) free = `${key}-${count}`;
  taken.add(free);
  return free;
}

/**
 * `flow` with room for `count` columns before the Stage `key`: when it stands in a column lower
 * than `count`, it and every Stage from its column on move right by what is missing.
 */
function withRoomBefore(flow: readonly GridStage[], key: string, count: number): GridStage[] {
  const column = flow.find((stage) => stage.key === key)?.place.column ?? 0;
  const missing = count - column;
  if (missing <= 0) return [...flow];
  return flow.map((stage) =>
    stage.place.column < column ? stage : { ...stage, place: moved(stage.place, missing) },
  );
}

function moved(place: StagePlace, columns: number): StagePlace {
  return { column: place.column + columns, row: place.row };
}

/** The rows the Stages of `flow` take in the columns `from` to `to`, both included. */
function rowsIn(flow: readonly GridStage[], from: number, to: number): number[] {
  return flow
    .filter(({ place }) => place.column >= from && place.column <= to)
    .map(({ place }) => place.row);
}
