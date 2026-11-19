import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import {
  promptTemplateDomainSchema,
  type PromptTemplateDomain,
  type PromptTemplate,
  type PromptTemplateSummary,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { promptTemplateQueries } from "../../../api/prompt-templates.ts";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { BY_ANN } from "../../../shell/user.fixtures.ts";
import { PromptTemplatesSection } from "./prompt-templates-section.tsx";

/** Resolve's Brief as nobody changed it. */
export const BRIEF: PromptTemplate = {
  key: "work.resolve-brief",
  domain: "work",
  name: "Resolve's Brief",
  description: "What the person resolving a conflict is told.",
  customised: false,
  hasProblems: false,
  version: 0,
  savedAt: null,
  savedBy: null,
  text: "Resolve {{taskTitle}}.",
  defaultText: "Resolve {{taskTitle}}.",
  variables: [
    { name: "taskTitle", description: "The Task's title.", kind: "text" },
    { name: "urgent", description: "Whether it is urgent.", kind: "flag" },
    {
      name: "files",
      description: "The files in conflict.",
      kind: "list",
      fields: [{ name: "path", description: "The file's path." }],
    },
  ],
  problems: [],
};

/** A template of another domain, customised by Ann. */
export const GREETING: PromptTemplate = {
  key: "conversations.greeting",
  domain: "conversations",
  name: "Greeting",
  description: "How a Thread starts.",
  customised: true,
  hasProblems: false,
  version: 2,
  savedAt: "2026-11-10T10:00:00.000Z",
  savedBy: BY_ANN,
  text: "Hello.",
  defaultText: "Hi.",
  variables: [],
  problems: [],
};

export function summaryOf(template: PromptTemplate): PromptTemplateSummary {
  const {
    text: _text,
    defaultText: _default,
    variables: _variables,
    problems,
    ...summary
  } = template;
  return { ...summary, hasProblems: problems.length > 0 };
}

export interface ShownSection {
  readonly page: HTMLElement;
  readonly queryClient: QueryClient;
  readonly router: AnyRouter;
}

let root: Root | undefined;

/** Unmounts the section shown last, for an `afterEach`. */
export function unmountSection(): void {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
}

/** Settings › Prompt templates at `address`, with `templates` already read. */
export async function shownSection(
  templates: readonly PromptTemplate[],
  address = "/settings/prompt-templates",
): Promise<ShownSection> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(promptTemplateQueries.list().queryKey, templates.map(summaryOf));
  for (const template of templates) {
    queryClient.setQueryData(promptTemplateQueries.read(template.key).queryKey, template);
  }
  const rootRoute = createRootRoute({
    component: () => (
      <ToastProvider>
        <PageHeadingProvider setPageHeading={() => undefined}>
          <Outlet />
        </PageHeadingProvider>
      </ToastProvider>
    ),
  });
  const sectionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/prompt-templates",
    component: PromptTemplatesSection,
    // As the app's route reads it (router.tsx, which nothing here may import).
    validateSearch: (
      search: Record<string, unknown>,
    ): { domain?: PromptTemplateDomain; template?: string } => {
      const domain = promptTemplateDomainSchema.safeParse(search.domain);
      return {
        ...(domain.success && { domain: domain.data }),
        ...(typeof search.template === "string" && { template: search.template }),
      };
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sectionRoute]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return { page, queryClient, router };
}
