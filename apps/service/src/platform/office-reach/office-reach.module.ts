import { Module, type DynamicModule } from "@nestjs/common";
import { OfficeReachConfig } from "./office-reach-config.js";

/** Tells every module where the running Office's API and database are, as configured. */
@Module({})
export class OfficeReachModule {
  static forRoot(apiPort: number, databaseUrl: string): DynamicModule {
    return {
      module: OfficeReachModule,
      global: true,
      providers: [
        { provide: OfficeReachConfig, useValue: new OfficeReachConfig(apiPort, databaseUrl) },
      ],
      exports: [OfficeReachConfig],
    };
  }
}
