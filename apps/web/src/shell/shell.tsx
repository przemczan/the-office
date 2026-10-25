import { Outlet, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** The frame every surface opens in. */
export function Shell(): ReactNode {
  const title = useMatches({ select: (matches) => matches.at(-1)?.staticData.title });
  return (
    <main>
      <h1>{title}</h1>
      <Outlet />
    </main>
  );
}
