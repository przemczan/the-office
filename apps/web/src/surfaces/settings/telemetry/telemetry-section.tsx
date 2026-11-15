import type { ReactNode } from "react";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { TelemetryCard } from "./telemetry-card.tsx";

/** Settings › Telemetry: where The Office exports its traces, metrics and logs. */
export function TelemetrySection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Telemetry" });
  return <TelemetryCard />;
}
