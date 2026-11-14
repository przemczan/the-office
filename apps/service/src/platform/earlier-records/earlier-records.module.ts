import { Global, Module } from "@nestjs/common";
import { EarlierRecords } from "./earlier-records.js";

/** One `EarlierRecords` for the whole app, which every module with earlier records adds to. */
@Global()
@Module({ providers: [EarlierRecords], exports: [EarlierRecords] })
export class EarlierRecordsModule {}
