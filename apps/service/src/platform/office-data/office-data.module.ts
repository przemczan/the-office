import { Module, type DynamicModule } from "@nestjs/common";
import { OfficeDataDirectory } from "./office-data-directory.js";

/** Gives every module the Office data directory. */
@Module({})
export class OfficeDataModule {
  static forRoot(path: string): DynamicModule {
    return {
      module: OfficeDataModule,
      global: true,
      providers: [{ provide: OfficeDataDirectory, useValue: new OfficeDataDirectory(path) }],
      exports: [OfficeDataDirectory],
    };
  }
}
