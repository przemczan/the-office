import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ProjectWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { IssueLinkChanged, IssuesImported } from "../../domain/issue-link-events.js";

type WebEventOf<Type extends ProjectWebEvent["type"]> = Omit<
  Extract<ProjectWebEvent, { type: Type }>,
  "occurredAt"
>;

/**
 * Issues imported reach the web naming the Project, so the board and the Import issues window
 * refetch; a Task's issue record changing names the Task, so its page refetches it.
 */
@Injectable()
export class IssueWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(IssuesImported, (event): WebEventOf<"project.issues-imported"> => ({
      type: "project.issues-imported",
      projectId: event.projectId,
    }));
    this.forwarding.forward(IssueLinkChanged, (event): WebEventOf<"issue-link.changed"> => ({
      type: "issue-link.changed",
      projectId: event.projectId,
      taskId: event.taskId,
    }));
  }
}
