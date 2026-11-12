import { Link } from "@tanstack/react-router";
import type { Decision, Initiative, Project, Task } from "@the-office/contracts";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { PLANNING_STEP_WORDS, planningStepOf } from "./initiative-planning-words.ts";
import { ordinaryTasksOf, taskGraph, type GraphEdge, type GraphNode } from "./initiative-words.ts";

interface DrawnEdge {
  readonly key: string;
  readonly path: string;
  readonly blockerDone: boolean;
}

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
  const drawn = useDrawnEdges(box, graph.edges);
  return (
    <div className="task-graph" ref={box} role="group" aria-label="Task graph">
      <svg className="task-graph-edges" aria-hidden="true">
        <defs>
          <marker
            id="task-graph-arrow"
            viewBox="0 0 8 8"
            refX="6"
            refY="4"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="task-graph-arrow" />
          </marker>
        </defs>
        {drawn.map(({ key, path, blockerDone }) => (
          <path
            key={key}
            d={path}
            className={blockerDone ? "blocker-done" : undefined}
            markerEnd="url(#task-graph-arrow)"
          />
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

/** The edges' curves, measured from where the nodes were laid out, again whenever the box resizes. */
function useDrawnEdges(
  box: RefObject<HTMLDivElement | null>,
  edges: readonly GraphEdge[],
): DrawnEdge[] {
  const [drawn, setDrawn] = useState<DrawnEdge[]>([]);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const draw = (): void => setDrawn(edgeCurves(element, edges));
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, edges]);
  return drawn;
}

function edgeCurves(element: HTMLElement, edges: readonly GraphEdge[]): DrawnEdge[] {
  const origin = element.getBoundingClientRect();
  const nodeBox = (taskId: string): DOMRect | undefined =>
    element.querySelector(`[data-task="${CSS.escape(taskId)}"]`)?.getBoundingClientRect();
  return edges.flatMap(({ from, to, blockerDone }) => {
    const blocker = nodeBox(from);
    const waiting = nodeBox(to);
    if (!blocker || !waiting) return [];
    const x1 = blocker.right - origin.left + element.scrollLeft;
    const y1 = blocker.top + blocker.height / 2 - origin.top;
    const x2 = waiting.left - origin.left + element.scrollLeft - 6;
    const y2 = waiting.top + waiting.height / 2 - origin.top;
    const middle = (x1 + x2) / 2;
    return [
      {
        key: `${from}>${to}`,
        path: `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`,
        blockerDone,
      },
    ];
  });
}
