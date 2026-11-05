import type { ReactNode } from "react";
import "./needs-you-list.css";

/** Decisions and Gates as cards that read alike wherever they wait; in a Thread a Decision stays short. */
export function NeedsYouList({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="needs-you-list">{children}</div>;
}
