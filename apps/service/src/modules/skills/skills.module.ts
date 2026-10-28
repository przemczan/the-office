import {
  Logger,
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { SKILL_UPLOAD_BYTES } from "@the-office/contracts";
import { uploadBody } from "../../platform/http/upload-body.js";
import { FilesystemLibraryFolder } from "./adapters/filesystem/filesystem-library-folder.js";
import { FilesystemSessionFolders } from "./adapters/filesystem/filesystem-session-folders.js";
import { GitProjectSkillFiles } from "./adapters/git/git-project-skill-files.js";
import { GitSourceFetcher } from "./adapters/git/git-source-fetcher.js";
import { SkillsController } from "./adapters/http/skills.controller.js";
import { PostgresRoleSkillRepository } from "./adapters/postgres/postgres-role-skill-repository.js";
import { PostgresSessionSkillRepository } from "./adapters/postgres/postgres-session-skill-repository.js";
import { PostgresSkillRepository } from "./adapters/postgres/postgres-skill-repository.js";
import { SkillWebEvents } from "./adapters/websocket/skill-web-events.js";
import { YauzlZipReader } from "./adapters/zip/yauzl-zip-reader.js";
import { ProjectSkills } from "./application/project-skills.js";
import { RoleSkills } from "./application/role-skills.js";
import { SessionSkills } from "./application/session-skills.js";
import { SkillLibrary } from "./application/skill-library.js";
import { SkillSources } from "./application/skill-sources.js";
import { LibraryFolder } from "./ports/library-folder.js";
import { ProjectSkillFiles } from "./ports/project-skill-files.js";
import { RoleSkillRepository } from "./ports/role-skill-repository.js";
import { SessionFolders } from "./ports/session-folders.js";
import { SessionSkillRepository } from "./ports/session-skill-repository.js";
import { SkillRepository } from "./ports/skill-repository.js";
import { SourceFetcher } from "./ports/source-fetcher.js";
import { ZipReader } from "./ports/zip-reader.js";

@Module({
  controllers: [SkillsController],
  providers: [
    { provide: SkillRepository, useClass: PostgresSkillRepository },
    { provide: SessionSkillRepository, useClass: PostgresSessionSkillRepository },
    { provide: RoleSkillRepository, useClass: PostgresRoleSkillRepository },
    { provide: LibraryFolder, useClass: FilesystemLibraryFolder },
    { provide: SessionFolders, useClass: FilesystemSessionFolders },
    { provide: ProjectSkillFiles, useClass: GitProjectSkillFiles },
    { provide: ZipReader, useClass: YauzlZipReader },
    { provide: SourceFetcher, useClass: GitSourceFetcher },
    SkillLibrary,
    SkillSources,
    SessionSkills,
    ProjectSkills,
    RoleSkills,
    SkillWebEvents,
  ],
  exports: [SkillLibrary, SkillSources, SessionSkills, ProjectSkills, RoleSkills],
})
export class SkillsModule implements NestModule, OnApplicationBootstrap {
  private readonly logger = new Logger(SkillsModule.name);

  constructor(private readonly sessionSkills: SessionSkills) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody(SKILL_UPLOAD_BYTES))
      .forRoutes(
        { path: "skills/uploads", method: RequestMethod.POST },
        { path: "skills/:name/versions", method: RequestMethod.POST },
      );
  }

  /** Before the service takes requests, so no version is kept while the sweep runs. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.sessionSkills.sweep();
    } catch (error) {
      // What it leaves is harmless, and the next start sweeps again.
      this.logger.warn(`Could not sweep the skill folders: ${(error as Error).message}`);
    }
  }
}
