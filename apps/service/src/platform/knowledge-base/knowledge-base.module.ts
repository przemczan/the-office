import { Global, Module } from "@nestjs/common";
import { KnowledgeBase } from "./knowledge-base.js";

/** One `KnowledgeBase` for the whole app, looked for once in the install as the app starts. */
@Global()
@Module({
  providers: [{ provide: KnowledgeBase, useFactory: () => KnowledgeBase.at() }],
  exports: [KnowledgeBase],
})
export class KnowledgeBaseModule {}
