import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  promptTemplateDomainSchema,
  type PromptTemplateDomain,
  type PromptTemplateSummary,
} from "@the-office/contracts";
import { Badge, Icon, PickList, PickListItem, Tabs } from "@the-office/ui";
import type { ReactNode } from "react";
import { promptTemplateQueries } from "../../../api/prompt-templates.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { SettingsProblem } from "../settings-card-parts.tsx";
import { PromptTemplateForm } from "./prompt-template-form.tsx";
import { DOMAIN_LABELS, domainsOf } from "./prompt-template-words.ts";
import "./prompt-templates.css";

const PATH = "/settings/prompt-templates";

/** The warning mark's words on a template whose saved text no longer passes the check. */
export const STORED_PROBLEMS_MARK = "The saved text no longer passes the check";

/**
 * Settings › Prompt templates: a tab per domain, under it the domain's templates beside the open
 * one, as Settings › Pipelines lists its own; on a narrow page the list or the open template shows.
 */
export function PromptTemplatesSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Prompt templates" });
  const search = useSearch({ from: PATH });
  const navigate = useNavigate();
  const list = useQuery(promptTemplateQueries.list());
  if (!list.data) {
    return <SettingsProblem title="The Prompt templates can't be read" error={list.error} />;
  }
  const domains = domainsOf(list.data);
  const domain = search.domain && domains.includes(search.domain) ? search.domain : domains[0];
  if (!domain) return <p className="settings-note">No Prompt template yet.</p>;
  const inDomain = list.data.filter((summary) => summary.domain === domain);
  const open = inDomain.find(({ key }) => key === search.template) ?? inDomain[0];
  const showingDetail = search.template !== undefined;
  const pickDomain = (value: string): void => {
    const picked = promptTemplateDomainSchema.safeParse(value);
    if (!picked.success) return;
    void navigate({ to: PATH, search: { domain: picked.data }, replace: true });
  };
  return (
    <div className="prompt-templates">
      <Tabs
        tabs={domains.map((value) => ({
          value,
          label: DOMAIN_LABELS[value],
          count: list.data.filter((summary) => summary.domain === value).length,
        }))}
        value={domain}
        onChange={pickDomain}
      />
      <div className={showingDetail ? "settings-split showing-detail" : "settings-split"}>
        <div className="library-lists">
          <TemplateList domain={domain} templates={inDomain} open={open} />
        </div>
        <div className="library-detail">
          <Link className="settings-back" to={PATH} search={{ domain }} replace>
            <Icon name="chevron-left" size={14} />
            All Prompt templates
          </Link>
          {open && (
            // Each template starts its own form.
            <PromptTemplateForm key={open.key} templateKey={open.key} />
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateList({
  domain,
  templates,
  open,
}: {
  readonly domain: PromptTemplateDomain;
  readonly templates: readonly PromptTemplateSummary[];
  readonly open: PromptTemplateSummary | undefined;
}): ReactNode {
  return (
    <PickList name={`${DOMAIN_LABELS[domain]} Prompt templates`} count={templates.length}>
      {templates.map((template) => (
        <PickListItem
          key={template.key}
          picked={template.key === open?.key}
          name={template.name}
          line={template.description}
          aside={
            template.customised && (
              <Badge size="sm" tone="accent">
                Customised
              </Badge>
            )
          }
          warning={template.hasProblems ? STORED_PROBLEMS_MARK : undefined}
          renderLink={(parts) => (
            <Link to={PATH} search={{ domain, template: template.key }} replace {...parts} />
          )}
        />
      ))}
    </PickList>
  );
}
