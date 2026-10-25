import { Module } from "@nestjs/common";
import { FilesystemLibraryFolder } from "./adapters/filesystem/filesystem-library-folder.js";
import { PostgresSkillRepository } from "./adapters/postgres/postgres-skill-repository.js";
import { LibraryFolder } from "./ports/library-folder.js";
import { SkillRepository } from "./ports/skill-repository.js";

@Module({
  providers: [
    { provide: SkillRepository, useClass: PostgresSkillRepository },
    { provide: LibraryFolder, useClass: FilesystemLibraryFolder },
  ],
})
export class SkillsModule {}
