import type { Project, ProjectFeature } from "@the-office/contracts";
import type { ReactNode } from "react";
import { OnboardingBlock } from "../onboarding-block.tsx";
import { useOpenProject } from "../project-page.tsx";
import { WorkBlock } from "../work-block.tsx";
import { CiTile, PullRequestsTile, RemoteSignInTile } from "./code-host-tiles.tsx";
import { EnvironmentTile, TestInstancesTile } from "./environment-tiles.tsx";
import { IdeasTile, InitiativesTile, RecentActivityTile } from "./work-record-tiles.tsx";
import "./overview.css";

interface Tile {
  readonly key: string;
  readonly Tile: (props: { readonly project: Project }) => ReactNode;
  /** The feature switch it hides with, as the Project's tabs do. */
  readonly feature?: ProjectFeature;
}

const TILES: readonly Tile[] = [
  { key: "initiatives", Tile: InitiativesTile },
  { key: "ideas", Tile: IdeasTile },
  { key: "ci", Tile: CiTile },
  { key: "pull-requests", Tile: PullRequestsTile },
  { key: "test-instances", Tile: TestInstancesTile, feature: "test-targets" },
  { key: "environment", Tile: EnvironmentTile },
  { key: "remote-sign-in", Tile: RemoteSignInTile },
  { key: "recent-activity", Tile: RecentActivityTile },
];

/**
 * The Project's Overview, a dashboard of how it stands: its onboarding and its Tasks, then a grid
 * of tiles, each linking to where its details live and refreshing from its own events.
 */
export function ProjectOverviewSection(): ReactNode {
  return <ProjectOverview project={useOpenProject()} />;
}

export function ProjectOverview({ project }: { readonly project: Project }): ReactNode {
  return (
    <div className="project-overview">
      <ActionsSlot />
      <OnboardingBlock project={project} />
      <WorkBlock project={project} />
      <div className="project-overview-grid">
        {TILES.filter(({ feature }) => feature === undefined || project.features[feature]).map(
          ({ key, Tile }) => (
            <Tile key={key} project={project} />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * The Overview's first place, kept for the Project's Actions (spec §2.15), which start from here
 * once they exist; until then it shows nothing.
 */
function ActionsSlot(): ReactNode {
  return null;
}
