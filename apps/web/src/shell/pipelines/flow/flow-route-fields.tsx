import { ROUTE_LIMIT_MAX, type Route, type RouteLimit, type Stage } from "@the-office/contracts";
import { Select, Stepper } from "@the-office/ui";
import type { ReactNode } from "react";
import { routeTargetName } from "./condition-words.ts";
import { inFlowOrder, limitOf, ROUTE_BACK_LIMIT } from "./flow-model.ts";

/** The Goes to select's value for End. */
const END = "";

/**
 * A route's Goes to (spec §2.3, "The route forms"): every Stage of the Pipeline in its order, the
 * route's own Stage included, then End; a target no longer in the flow stays listed as gone.
 */
export function FlowRouteTarget({
  route,
  stages,
  hint,
  onChange,
}: {
  readonly route: Route;
  readonly stages: readonly Stage[];
  readonly hint?: string;
  readonly onChange: (to: string | null) => void;
}): ReactNode {
  const gone =
    route.to !== null && !stages.some(({ key }) => key === route.to)
      ? [{ value: route.to, label: `${routeTargetName(route, stages)} (gone)` }]
      : [];
  const options = [
    ...gone,
    ...inFlowOrder(stages).map(({ key, name }) => ({ value: key, label: name })),
    { value: END, label: "End" },
  ];
  return (
    <Select
      size="sm"
      label="Goes to"
      {...(hint === undefined ? {} : { hint })}
      value={route.to ?? END}
      options={options}
      onChange={(to) => onChange(to === END ? null : to)}
    />
  );
}

/**
 * A route's At most (spec §2.3, "A route's limit"): a stepper from 1 to 9 with "times", and No
 * limit, which ticked holds the stepper; unticked, the route starts at 3 times. In Routes out, one
 * per row, each control is named by the route's target too.
 */
export function FlowRouteLimit({
  from,
  route,
  stages,
  hint,
  onChange,
}: {
  readonly from: Stage;
  readonly route: Route;
  readonly stages: readonly Stage[];
  readonly hint?: string;
  readonly onChange: (limit: RouteLimit) => void;
}): ReactNode {
  const limit = limitOf(stages, from.key, route);
  const target = routeTargetName(route, stages);
  return (
    <div className="flow-route-limit" role="group" aria-label={`At most, route to ${target}`}>
      <span className="flow-route-limit-label">At most</span>
      <span className="flow-route-limit-row">
        <Stepper
          label={`times on the route to ${target}`}
          value={limit ?? ROUTE_BACK_LIMIT}
          min={1}
          max={ROUTE_LIMIT_MAX}
          format={(value) => (limit === null ? "–" : String(value))}
          disabled={limit === null}
          onChange={onChange}
        />
        <span>{limit === 1 ? "time" : "times"}</span>
        <label className="flow-route-limit-none">
          <input
            type="checkbox"
            checked={limit === null}
            onChange={(event) => onChange(event.target.checked ? null : ROUTE_BACK_LIMIT)}
          />
          No limit
        </label>
      </span>
      {hint !== undefined && <span className="flow-panel-hint">{hint}</span>}
    </div>
  );
}
