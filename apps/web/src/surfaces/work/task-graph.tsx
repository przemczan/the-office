import { Link } from "@tanstack/react-router";
import type { Decision, Initiative, Project, TaskSummary } from "@the-office/contracts";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
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
import { edgeHighlight, type EdgeHighlight } from "./task-graph-highlight.ts";
import {
  edgeRoom,
  routeEdges,
  type EdgeRoute,
  type RouteEdge,
  type TaskBox,
} from "./task-graph-routes.ts";

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
  readonly tasks: readonly TaskSummary[];
  /** The Decisions waiting on the user, `GET /decisions/open`. */
  readonly openDecisions: readonly Decision[];
  readonly initiatives: readonly Initiative[] | undefined;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const graph = useMemo(
    () => taskGraph(ordinaryTasksOf(initiative, tasks), tasks),
    [initiative, tasks],
  );
  const columns = useRef<HTMLDivElement>(null);
  const { routes, room } = useEdgeRoutes(columns, graph);
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const highlighted = hovered ?? focused;
  const drawn = routes
    .map((route) => ({ route, highlight: edgeHighlight(route, highlighted) }))
    // The highlighted edges are drawn last, over the dimmed ones they cross.
    .toSorted((first, second) => drawOrder(first.highlight) - drawOrder(second.highlight));
  return (
    <>
      <GraphLegend kinds={graphLineKinds(graph)} />
      <div
        className="task-graph"
        role="group"
        aria-label="Task graph"
        style={
          {
            "--task-graph-room-above": `${room.above}px`,
            "--task-graph-room-below": `${room.below}px`,
          } as CSSProperties
        }
      >
        <div className="task-graph-columns" ref={columns}>
          <svg className="task-graph-edges" aria-hidden="true">
            {drawn.map(({ route: { key, line, head, blockerDone, fromOutside }, highlight }) => (
              <g
                key={key}
                className={
                  highlight &&
                  classes(highlight !== "dimmed" && "highlighted", `highlight-${highlight}`)
                }
              >
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
                  onHover={setHovered}
                  onFocus={setFocused}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function drawOrder(highlight: EdgeHighlight | undefined): number {
  return highlight === undefined || highlight === "dimmed" ? 0 : 1;
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
  onHover,
  onFocus,
}: {
  readonly node: GraphNode;
  readonly initiative: Initiative;
  readonly openDecisions: readonly Decision[];
  readonly initiatives: readonly Initiative[] | undefined;
  readonly projects: readonly Project[] | undefined;
  /** The Task hovered, or none once the pointer leaves it. */
  readonly onHover: (taskId: string | undefined) => void;
  /** The Task focused, or none once focus leaves it. */
  readonly onFocus: (taskId: string | undefined) => void;
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
      onMouseEnter={() => onHover(task.id)}
      onMouseLeave={() => onHover(undefined)}
      onFocus={() => onFocus(task.id)}
      onBlur={() => onFocus(undefined)}
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

function outsideWords(task: TaskSummary, initiatives: readonly Initiative[] | undefined): string {
  const initiative = initiatives?.find(({ id }) => id === task.initiativeId);
  return initiative ? `Initiative ${initiative.name}` : "outside this Initiative";
}

function classes(...names: readonly (string | false)[]): string {
  return names.filter(Boolean).join(" ");
}

/**
 * The edges' routes, measured from where the nodes were laid out in the columns, again whenever the
 * columns resize, and the room the routes need above and below them.
 */
function useEdgeRoutes(
  columns: RefObject<HTMLDivElement | null>,
  graph: TaskGraphLayout,
): { routes: EdgeRoute[]; room: { above: number; below: number } } {
  const edges = useMemo(() => routeEdgesOf(graph), [graph]);
  const [drawn, setDrawn] = useState<{
    routes: EdgeRoute[];
    room: { above: number; below: number };
  }>({ routes: [], room: { above: 0, below: 0 } });
  useLayoutEffect(() => {
    const element = columns.current;
    if (!element) return;
    const draw = (): void => {
      const routes = routeEdges(measuredBoxes(element, graph.columns), edges);
      setDrawn({ routes, room: edgeRoom(routes, element.offsetHeight) });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [columns, graph, edges]);
  return drawn;
}

function routeEdgesOf({ columns, edges }: TaskGraphLayout): RouteEdge[] {
  const outsideIds = new Set(
    columns.flat().flatMap(({ task, outside }) => (outside ? [task.id] : [])),
  );
  return edges.map((edge) => ({ ...edge, fromOutside: outsideIds.has(edge.from) }));
}

/**
 * Each node's box in the columns' own coordinates, which the room around them never moves; they
 * scroll sideways with the graph.
 */
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
        return [
          [
            task.id,
            {
              left: left - origin.left,
              right: right - origin.left,
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
