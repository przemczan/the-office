import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ActionLastRuns } from "../../../projects/index.js";
import { ActionRuns } from "../../application/action-runs.js";

/** Gives Projects each Action's last run, which `list_projects` names, as the module starts. */
@Injectable()
export class ActionLastRunsRegistration implements OnModuleInit {
  constructor(
    private readonly lastRuns: ActionLastRuns,
    private readonly runs: ActionRuns,
  ) {}

  onModuleInit(): void {
    this.lastRuns.register((projectId) => this.runs.lastRuns(projectId));
  }
}
