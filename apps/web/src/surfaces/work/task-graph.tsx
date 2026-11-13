import { Link } from "@tanstack/react-router";
import type { Decision, Initiative, Project, Task } from "@the-office/contracts";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { PLANNING_STEP_WORDS, planningStepOf } from "./initiative-planning-words.ts";
import {
  graphLineKinds,
  ordinaryTasksOf,
  taskGraph,
  type GraphLineKind,
  type GraphNode,
  type TaskGraph as TaskGraphLayout,
} from "./initiative-words.ts";
import { routeEdges, type EdgeRoute, type RouteEdge, type TaskBox } from "./task-graph-routes.ts";

/**
 * The Initiative's Tasks as a graph (prototypes/app/work.js `graph`): a column per dependency
 * depth, an arrow meaning "must be Done first", and blockers from outside the Initiative dashed.
 * While the Initiative is planned (Plan the Initiative), each of its Tasks says how far its planning
 * is, Waiting for your answer while a Decision on it is open.
 */
export function TaskGraph({
  initiative,
  tasks,
  openDecisions,
  initiatives,
  projects,
}: {
  readonly initiative: Initiative;
  /** Every Task, as read: the graph is laid out again only when they change. */
  readonly tasks: readonly Task[];
  /** The Decisions waiting on the user, `GET /decisions/open`. */
  readonly openDecisions: readonly Decision[];
  readonly initiatives: readonly Initiative[] | undefined;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const graph = useMemo(
    () => taskGraph(ordinaryTasksOf(initiative, tasks), tasks),
    [initiative, tasks],
  );
  const box = useRef<HTMLDivElement>(null);
  const routes = useEdgeRoutes(box, graph);
  return (
    <>
      <GraphLegend kinds={graphLineKinds(graph)} />
      <div className="task-graph" ref={box} role="group" aria-label="Task graph">
        <svg className="task-graph-edges" aria-hidden="true">
          {routes.map(({ key, line, head, blockerDone, fromOutside }) => (
            <g key={key}>
              <path
                d={line}
                className={classes(
                  "task-graph-edge",
                  blockerDone && "blocker-done",
                  fromOutside && "from-outside",
                )}
              />
              <path
                d={head}
                className={classes("task-graph-head", blockerDone && "blocker-done")}
              />
            </g>
          ))}
        </svg>
        <div className="task-graph-columns">
          {graph.columns.map((column) => (
            <div key={column[0]?.task.id} className="task-graph-column">
              {column.map((node) => (
                <TaskNode
                  key={node.task.id}
                  node={node}
                  initiative={initiative}
                  openDecisions={openDecisions}
                  initiatives={initiatives}
                  projects={projects}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const LINE_KIND_WORDS: Readonly<Record<GraphLineKind, string>> = {
  "must-be-done-first": "must be Done first",
  "blocker-done": "its blocker is Done",
  "from-outside": "from outside this Initiative",
};

/** A sample of each kind of line the graph holds, with what it means. */
function GraphLegend({ kinds }: { readonly kinds: readonly GraphLineKind[] }): ReactNode {
  return (
    <ul className="task-graph-legend" aria-label="What the arrows mean">
      {kinds.map((kind) => (
        <li key={kind}>
          <svg className="task-graph-legend-sample" viewBox="0 0 28 8" aria-hidden="true">
            <path
              d="M0 4H20"
              className={classes(
                "task-graph-edge",
                kind === "blocker-done" && "blocker-done",
                kind === "from-outside" && "from-outside",
              )}
            />
            <path
              d="M20 0L28 4L20 8Z"
              className={classes("task-graph-head", kind === "blocker-done" && "blocker-done")}
            />
          </svg>
          {LINE_KIND_WORDS[kind]}
        </li>
      ))}
    </ul>
  );
}

function TaskNode({
  node: { task, outside },
  initiative,
  openDecisions,
  initiatives,
  projects,
}: {
  readonly node: GraphNode;
  readonly initiative: Initiative;
  readonly openDecisions: readonly Decision[];
  readonly initiatives: readonly Initiative[] | undefined;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  const step = outside ? undefined : planningStepOf(initiative, task, openDecisions);
  // Planning and Ready are the state badge's own words: only the other steps add to it.
  const stepNote =
    step === "planning" || step === "ready" ? undefined : step && PLANNING_STEP_WORDS[step];
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: task.id }}
      className={`task-graph-node${outside ? " outside" : ""}`}
      data-task={task.id}
    >
      <span className="task-graph-node-title">
        {project && <ProjectMark project={project} />}
        {task.title}
      </span>
      <span className="task-graph-node-sub">
        <TaskStateBadge state={task.state} />
        {outside && <span>{outsideWords(task, initiatives)}</span>}
        {stepNote && <span className="task-graph-node-step">{stepNote}</span>}
      </span>
    </Link>
  );
}

function outsideWords(task: Task, initiatives: readonly Initiative[] | undefined): string {
  const initiative = initiatives?.find(({ id }) => id === task.initiativeId);
  return initiative ? `Initiative ${initiative.name}` : "outside this Initiative";
}

function classes(...names: readonly (string | false)[]): string {
  return names.filter(Boolean).join(" ");
}

/** The edges' routes, measured from where the nodes were laid out, again whenever the box resizes. */
function useEdgeRoutes(box: RefObject<HTMLDivElement | null>, graph: TaskGraphLayout): EdgeRoute[] {
  const edges = useMemo(() => routeEdgesOf(graph), [graph]);
  const [routes, setRoutes] = useState<EdgeRoute[]>([]);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const draw = (): void => setRoutes(routeEdges(measuredBoxes(element, graph.columns), edges));
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, graph, edges]);
  return routes;
}

function routeEdgesOf({ columns, edges }: TaskGraphLayout): RouteEdge[] {
  const outsideIds = new Set(
    columns.flat().flatMap(({ task, outside }) => (outside ? [task.id] : [])),
  );
  return edges.map((edge) => ({ ...edge, fromOutside: outsideIds.has(edge.from) }));
}

/** Each node's box in the graph's own coordinates, as the graph scrolls sideways. */
function measuredBoxes(
  element: HTMLElement,
  columns: TaskGraphLayout["columns"],
): Map<string, TaskBox> {
  const origin = element.getBoundingClientRect();
  return new Map(
    columns.flatMap((column, index) =>
      column.flatMap(({ task }): [string, TaskBox][] => {
        const node = element.querySelector(`[data-task="${CSS.escape(task.id)}"]`);
        if (!node) return [];
        const { left, right, top, bottom } = node.getBoundingClientRect();
        const x = element.scrollLeft - origin.left;
        return [
          [
            task.id,
            {
              left: left + x,
              right: right + x,
              top: top - origin.top,
              bottom: bottom - origin.top,
              column: index,
            },
          ],
        ];
      }),
    ),
  );
}
