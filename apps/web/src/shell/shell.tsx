import { Outlet, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Rail } from "./rail.tsx";
import "./shell.css";
import { StatusStrip } from "./status-strip.tsx";
import { TopBar } from "./top-bar.tsx";

/** Shell A3 · Desk: the frame every surface opens in. */
export function Shell(): ReactNode {
  const title = useMatches({ select: (matches) => matches.at(-1)?.staticData.title });
  return (
    <div className="shell">
      <Rail />
      <TopBar title={title} />
      <StatusStrip />
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
