import { Controller, Get, Param, ParseUUIDPipe, Query, UseFilters } from "@nestjs/common";
import {
  afterSequenceQuerySchema,
  type AfterSequenceQuery,
  type ProcessOutput,
  type SubAgentMessages,
  type SubAgentOrProcess,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SubAgentsAndProcesses } from "../../application/sub-agents-and-processes.js";
import {
  toProcessOutputResponse,
  toSubAgentMessagesResponse,
  toSubAgentOrProcessResponse,
} from "./sub-agent-and-process-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

/**
 * A Thread's Sub-agents and Processes (spec 2.9): the list, without messages or output, and each
 * one's messages or output after a sequence, which a page opened late reads to catch up.
 */
@Controller("threads/:id")
@UseFilters(ThreadRefusalsFilter)
export class SubAgentsAndProcessesController {
  constructor(private readonly subAgentsAndProcesses: SubAgentsAndProcesses) {}

  @Get("sub-agents-and-processes")
  async list(@Param("id", ParseUUIDPipe) id: string): Promise<SubAgentOrProcess[]> {
    const items = await this.subAgentsAndProcesses.list(id);
    return items.map(toSubAgentOrProcessResponse);
  }

  @Get("sub-agents/:callId/messages")
  async messages(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("callId") callId: string,
    @Query(new ContractPipe(afterSequenceQuerySchema)) { after }: AfterSequenceQuery,
  ): Promise<SubAgentMessages> {
    return toSubAgentMessagesResponse(await this.subAgentsAndProcesses.messages(id, callId, after));
  }

  @Get("processes/:callId/output")
  async output(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("callId") callId: string,
    @Query(new ContractPipe(afterSequenceQuerySchema)) { after }: AfterSequenceQuery,
  ): Promise<ProcessOutput> {
    return toProcessOutputResponse(await this.subAgentsAndProcesses.output(id, callId, after));
  }
}
