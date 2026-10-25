import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { FilesystemLibraryFolder } from "./adapters/filesystem/filesystem-library-folder.js";
import { SkillsController } from "./adapters/http/skills.controller.js";
import { uploadBody } from "./adapters/http/upload-body.js";
import { PostgresSkillRepository } from "./adapters/postgres/postgres-skill-repository.js";
import { YauzlZipReader } from "./adapters/zip/yauzl-zip-reader.js";
import { SkillLibrary } from "./application/skill-library.js";
import { LibraryFolder } from "./ports/library-folder.js";
import { SkillRepository } from "./ports/skill-repository.js";
import { ZipReader } from "./ports/zip-reader.js";

@Module({
  controllers: [SkillsController],
  providers: [
    { provide: SkillRepository, useClass: PostgresSkillRepository },
    { provide: LibraryFolder, useClass: FilesystemLibraryFolder },
    { provide: ZipReader, useClass: YauzlZipReader },
    SkillLibrary,
  ],
  exports: [SkillLibrary],
})
export class SkillsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody)
      .forRoutes(
        { path: "skills/uploads", method: RequestMethod.POST },
        { path: "skills/:name/versions", method: RequestMethod.POST },
      );
  }
}
