import type {
  IssueLink as IssueLinkResponse,
  OpenIssue as OpenIssueResponse,
} from "@the-office/contracts";
import type { IssueLinkRecord, OpenIssue } from "../../application/issue-import.js";
import { toAuthorResponse } from "./acted-by-responses.js";

export function toOpenIssueResponse({
  number,
  title,
  url,
  author,
  labels,
  openedAt,
  kind,
}: OpenIssue): OpenIssueResponse {
  return {
    number,
    title,
    url,
    author: { login: author.login, url: author.url },
    labels: [...labels],
    openedAt: openedAt.toISOString(),
    kind,
  };
}

/**
 * The imported-by of a link: The Office's auto-import, or the user or person who imported it by
 * hand.
 */
export function toIssueLinkResponse({
  link,
  writeBackProblem,
}: IssueLinkRecord): IssueLinkResponse {
  return {
    number: link.number,
    title: link.title,
    url: link.url,
    author: { login: link.author.login, url: link.author.url },
    importedAt: link.importedAt.toISOString(),
    importedBy:
      link.importedBy.kind === "office" ? { kind: "office" } : toAuthorResponse(link.importedBy),
    closedOnHostAt: link.closedOnHostAt?.toISOString() ?? null,
    writeBackProblem,
  };
}
