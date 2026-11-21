import { Injectable } from "@nestjs/common";
import { initiativeBranchOf, InitiativeNotFound, InitiativeService } from "../../../work/index.js";
import { Initiatives, type InitiativeForTestInstances } from "../../ports/initiatives.js";

type Initiative = Awaited<ReturnType<InitiativeService["read"]>>;

/** Work's Initiatives, each with its branch's name in each Project The Office made it in. */
@Injectable()
export class WorkInitiatives extends Initiatives {
  constructor(private readonly initiatives: InitiativeService) {
    super();
  }

  async find(id: string): Promise<InitiativeForTestInstances | undefined> {
    try {
      return forTestInstances(await this.initiatives.read(id));
    } catch (error) {
      if (error instanceof InitiativeNotFound) return undefined;
      throw error;
    }
  }

  async activeInitiativeOnBranch(
    projectId: string,
    branch: string,
  ): Promise<InitiativeForTestInstances | undefined> {
    return (await this.initiatives.list())
      .filter(({ state }) => state === "active")
      .map(forTestInstances)
      .find(({ branches }) =>
        branches.some((each) => each.projectId === projectId && each.branch === branch),
      );
  }
}

function forTestInstances({
  id,
  name,
  state,
  endedAt,
  shortName,
  branches,
}: Initiative): InitiativeForTestInstances {
  return {
    id,
    name,
    state,
    endedAt: state === "done" || state === "dropped" ? endedAt : undefined,
    branches:
      shortName === undefined
        ? []
        : branches.map(({ projectId }) => ({ projectId, branch: initiativeBranchOf(shortName) })),
  };
}
