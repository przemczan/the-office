import type { ReactNode } from "react";
import { DecisionCard, type DecisionCardProps } from "./decision-card.tsx";

/**
 * An open Decision where the user answers it, on its Task's page, on Now and in the Needs you panel
 * (spec §4): the form in place; a long one, or one with Attachments, the compact card with Accept
 * and Open details, its window; an approval its own card; a closed one its closed line.
 */
export function DecisionOnTask(props: Omit<DecisionCardProps, "where">): ReactNode {
  return <DecisionCard {...props} where="needs-you" />;
}
