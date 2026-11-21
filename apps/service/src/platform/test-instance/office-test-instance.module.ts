import { Module, type DynamicModule } from "@nestjs/common";
import { OfficeTestInstance } from "./office-test-instance.js";

/** Tells every module whether this service is a test instance of The Office (`OFFICE_TEST_INSTANCE`). */
@Module({})
export class OfficeTestInstanceModule {
  static forRoot(on: boolean): DynamicModule {
    return {
      module: OfficeTestInstanceModule,
      global: true,
      providers: [{ provide: OfficeTestInstance, useValue: new OfficeTestInstance(on) }],
      exports: [OfficeTestInstance],
    };
  }
}
