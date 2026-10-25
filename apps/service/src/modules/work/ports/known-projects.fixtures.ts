import { Injectable, Module } from "@nestjs/common";
import { KnownProjects, type KnownProject } from "./known-projects.js";

/** The one Project id KnownProjectsForTests doesn't know. */
export const UNKNOWN_PROJECT = "no-such-project";

/** Knows every Project but UNKNOWN_PROJECT, each with Quick fix as its default Pipeline. */
@Injectable()
export class KnownProjectsForTests extends KnownProjects {
  async find(id: string): Promise<KnownProject | undefined> {
    return id === UNKNOWN_PROJECT ? undefined : { id, defaultPipeline: "quick-fix" };
  }
}

/** Provides KnownProjectsForTests, for `WorkModule.register({ imports: [this module] })`. */
@Module({ providers: [KnownProjectsForTests], exports: [KnownProjectsForTests] })
export class KnownProjectsForTestsModule {}
