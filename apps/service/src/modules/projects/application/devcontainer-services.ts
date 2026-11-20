import { Injectable } from "@nestjs/common";

/**
 * The services of the repository's `.devcontainer/` definition at `commit`; undefined when the
 * repository has none there, or none that can be read.
 */
export type DevcontainerServicesReader = (
  projectId: string,
  commit: string,
) => Promise<readonly string[] | undefined>;

/**
 * Reads a repository's `.devcontainer/` services, for a test target's entry point (spec §2.12).
 * Run environments reads the definition and gives the reader as it starts: it reads Projects, so
 * Projects can't ask it directly (the module template's registry).
 */
@Injectable()
export class DevcontainerServices {
  private registered: DevcontainerServicesReader | undefined;

  register(reader: DevcontainerServicesReader): void {
    this.registered = reader;
  }

  async servicesAt(projectId: string, commit: string): Promise<readonly string[] | undefined> {
    if (!this.registered) throw new Error("No reader of .devcontainer/ services is registered.");
    return this.registered(projectId, commit);
  }
}
