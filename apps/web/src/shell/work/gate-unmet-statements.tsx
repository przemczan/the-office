import type { ReactNode } from "react";
import type { UnmetStatement } from "./gate-card-words.ts";

/**
 * At the Gate that is the Definition of Done check, the statements not Reported met, which Continue
 * calls met and publishes over (spec §2.3); an Out of reach one with its Agent's latest why.
 */
export function GateUnmetStatements({
  unmet,
}: {
  readonly unmet: readonly UnmetStatement[];
}): ReactNode {
  if (unmet.length === 0) return null;
  return (
    <section className="gate-unmet" aria-label="Definition of Done not reported met">
      <p className="gate-unmet-title">Not reported met</p>
      <ul className="gate-unmet-list">
        {unmet.map(({ statement, outOfReachWhy }, index) => (
          <li key={index}>
            {statement}
            {outOfReachWhy !== undefined && (
              <span className="gate-unmet-why">Out of reach: {outOfReachWhy}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
