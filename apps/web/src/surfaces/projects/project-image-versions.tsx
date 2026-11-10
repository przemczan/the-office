import type { Project, ProjectImageKey } from "@the-office/contracts";
import type { ReactNode } from "react";
import { IMAGE_PALETTES } from "../../shell/project-image.ts";
import { VersionTile } from "./version-tile.tsx";

const IMAGE_NAMES: Readonly<Record<ProjectImageKey, string>> = { icon: "Icon", logo: "Logo" };

const WHERE_IT_SHOWS: Readonly<Record<ProjectImageKey, string>> = {
  icon: "Shows in place of the mark's letters and colour, wherever the mark shows.",
  logo: "Stands for the Project on its page and its card, in place of the mark.",
};

/** One image of the Project in its light and dark versions, each changed on its own. */
export function ProjectImageVersions({
  project,
  imageKey,
}: {
  readonly project: Project;
  readonly imageKey: ProjectImageKey;
}): ReactNode {
  const name = IMAGE_NAMES[imageKey];
  return (
    <section className="image-versions" aria-label={name}>
      <div className="image-versions-head">
        <div className="image-versions-name">{name}</div>
        <div className="image-versions-hint">{WHERE_IT_SHOWS[imageKey]}</div>
      </div>
      <div className="image-versions-tiles">
        {IMAGE_PALETTES.map((palette) => (
          <VersionTile
            key={palette}
            project={project}
            imageKey={imageKey}
            imageName={name}
            palette={palette}
          />
        ))}
      </div>
    </section>
  );
}
