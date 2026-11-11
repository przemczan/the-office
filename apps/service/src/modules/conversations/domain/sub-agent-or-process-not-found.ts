export class SubAgentOrProcessNotFound extends Error {
  constructor(
    readonly threadId: string,
    readonly callId: string,
  ) {
    super(`Thread "${threadId}"'s session has no Sub-agent or Process "${callId}".`);
    this.name = "SubAgentOrProcessNotFound";
  }
}
