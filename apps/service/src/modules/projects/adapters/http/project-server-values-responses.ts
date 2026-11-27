import type {
  ProjectMcpServerValues as ProjectMcpServerValuesResponse,
  ProjectServerValue as ProjectServerValueResponse,
} from "@the-office/contracts";
import type { ProjectMcpServerValues, ProjectServerValueView } from "../../../mcp-servers/index.js";

/** A server's Server values on a Project as the API shows them, a secret's value never sent. */
export function toProjectMcpServerValuesResponse({
  serverName,
  serverValues,
}: ProjectMcpServerValues): ProjectMcpServerValuesResponse {
  return { serverName, serverValues: serverValues.map(toServerValueResponse) };
}

function toServerValueResponse({
  serverValue: { name, secret, required, officeWideValue },
  projectValue,
}: ProjectServerValueView): ProjectServerValueResponse {
  return {
    name,
    secret,
    required,
    ...(!secret && officeWideValue !== undefined && { officeWideValue }),
    officeWideValueSet: officeWideValue !== undefined,
    ...(!secret && projectValue !== undefined && { projectValue }),
    projectValueSet: projectValue !== undefined,
  };
}
