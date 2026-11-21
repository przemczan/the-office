import { Injectable } from "@nestjs/common";
import { initiativeBranchOf, InitiativeNotFound, InitiativeService } from "../../../work/index.js";
import { Initiatives, type InitiativeForTestInstances } from "../../ports/initiatives.js";

/** Work's Initiatives, each with its branch's name in each Project The Office made it in. */
@Injectable()
export class WorkInitiatives extends Initiatives {
  constructor(private readonly initiatives: InitiativeService) {
    super();
  }

  async find(id: string): Promise<InitiativeForTestInstances | undefined> {
    try {
      const { name, state, shortName, branches } = await this.initiatives.read(id);
      return {
        id,
        name,
        state,
        branches:
          shortName === undefined
            ? []
            : branches.map(({ projectId }) => ({
                projectId,
                branch: initiativeBranchOf(shortName),
              })),
      };
    } catch (error) {
      if (error instanceof InitiativeNotFound) return undefined;
      throw error;
    }
  }
}
