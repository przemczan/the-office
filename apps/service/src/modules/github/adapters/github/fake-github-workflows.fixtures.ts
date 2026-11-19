import { z } from "zod";
import { dispatchInputsOf } from "../../domain/workflow-dispatch.js";
import type { ApiAnswer, FakeInstallations } from "./fake-github-installations.fixtures.js";
import type { FakeWorkflowRuns } from "./fake-github-runs.fixtures.js";

/** A GitHub Actions workflow on the fake GitHub, as a test names it. */
export interface FakeWorkflow {
  /** Its file's name, such as release.yml. */
  readonly file: string;
  /** Its name; the file's unless named. */
  readonly name?: string;
  /** Its file's text at every ref, or by ref (a branch or tag), the file missing at any other. */
  readonly yaml: string | Readonly<Record<string, string>>;
  /** GitHub's `state`: `active` unless named, such as `disabled_manually`. */
  readonly state?: string;
  /** Where GitHub lists it; `.github/workflows/<file>` unless named, as for Dependabot's. */
  readonly path?: string;
}

/** A branch or a tag of a repository on the fake GitHub, by name. */
export type FakeRef = { readonly branch: string } | { readonly tag: string };

/** A `workflow_dispatch` the fake GitHub accepted, as it was asked for. */
export interface FakeDispatch {
  readonly repository: string;
  readonly file: string;
  readonly ref: string;
  readonly inputs: Readonly<Record<string, unknown>>;
}

/**
 * Not GitHub's: the body of `POST /_fake/workflows` (`FAKE_WORKFLOWS_CONTROL_PATH`), one of the
 * controls below by its `action`, for a test that reaches the fake only over HTTP.
 */
export const workflowControlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("addWorkflow"),
    repository: z.string().min(1),
    workflow: z.object({
      file: z.string().min(1),
      name: z.string().optional(),
      yaml: z.union([z.string(), z.record(z.string(), z.string())]),
      state: z.string().optional(),
      path: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("addRef"),
    repository: z.string().min(1),
    ref: z.union([z.object({ branch: z.string().min(1) }), z.object({ tag: z.string().min(1) })]),
  }),
]);
export type WorkflowControl = z.infer<typeof workflowControlSchema>;

const dispatchBodySchema = z.object({
  ref: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).optional(),
});

interface StoredWorkflow extends FakeWorkflow {
  readonly id: number;
}

interface Refs {
  readonly branches: string[];
  readonly tags: string[];
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/**
 * GitHub Actions workflows on the fake GitHub (docs.github.com/rest/actions/workflows): listing a
 * repository's, each file's contents at a ref (docs.github.com/rest/repos/contents), the branches
 * (`main` from the start) and tags, and `workflow_dispatch`, which queues a run on the ref. A
 * repository no installation reaches is 404; a dispatch needs the installation's `actions: write`
 * permission, and is 422 for a file at the ref without the trigger, an input it doesn't declare or
 * a required one left out.
 */
export class FakeWorkflows {
  private readonly workflows = new Map<string, StoredWorkflow[]>();
  private readonly refs = new Map<string, Refs>();
  private readonly accepted: FakeDispatch[] = [];

  constructor(
    private readonly web: string,
    private readonly installations: FakeInstallations,
    private readonly runs: FakeWorkflowRuns,
  ) {}

  /** Adds a workflow to the repository, as a push of its file would. */
  addWorkflow(repository: string, workflow: FakeWorkflow): void {
    const stored = this.workflowsOf(repository);
    stored.push({ ...workflow, id: 500 + stored.length });
  }

  /** Adds a branch or tag to the repository. */
  addRef(repository: string, ref: FakeRef): void {
    const refs = this.refsOf(repository);
    if ("branch" in ref) refs.branches.push(ref.branch);
    else refs.tags.push(ref.tag);
  }

  /** The dispatches accepted, in order. */
  dispatches(): readonly FakeDispatch[] {
    return [...this.accepted];
  }

  /** Applies a control posted to `/_fake/workflows`. */
  control(control: WorkflowControl): void {
    if (control.action === "addWorkflow") this.addWorkflow(control.repository, control.workflow);
    else this.addRef(control.repository, control.ref);
  }

  /** `GET /repos/{owner}/{repo}/actions/workflows`. */
  list(repository: string, request: URL): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    const workflows = this.workflowsOf(repository);
    return pageOf(request, workflows, (items) => ({
      total_count: workflows.length,
      workflows: items.map((workflow) => {
        const path = pathOf(workflow);
        return {
          id: workflow.id,
          name: workflow.name ?? workflow.file,
          path,
          state: workflow.state ?? "active",
          html_url: `${this.web}/${repository}/blob/main/${path}`,
        };
      }),
    }));
  }

  /** `GET /repos/{owner}/{repo}/contents/{path}?ref=`; a ref left out is `main`. */
  contents(repository: string, path: string, request: URL): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    const ref = request.searchParams.get("ref") ?? "main";
    if (!this.hasRef(repository, ref)) {
      return { status: 404, body: { message: `No commit found for the ref ${ref}` } };
    }
    const workflow = this.workflowsOf(repository).find((each) => pathOf(each) === path);
    const text = workflow && yamlAt(workflow, ref);
    if (text === undefined) return notFound();
    return {
      status: 200,
      body: {
        type: "file",
        encoding: "base64",
        name: path.slice(path.lastIndexOf("/") + 1),
        path,
        // GitHub breaks its base64 into lines.
        content: Buffer.from(text).toString("base64").replace(/.{60}/g, "$&\n"),
      },
    };
  }

  /** `GET /repos/{owner}/{repo}/branches` or `…/tags`. */
  listRefs(repository: string, kind: "branches" | "tags", request: URL): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    return pageOf(request, this.refsOf(repository)[kind], (names) =>
      names.map((name) => ({ name })),
    );
  }

  /** `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`, by file name or id. */
  dispatch(repository: string, workflowId: string, body: string): ApiAnswer {
    if (!this.installations.reaches(repository)) return notFound();
    if (!this.installations.grants(repository, "actions", "write")) {
      return { status: 403, body: { message: "Resource not accessible by integration" } };
    }
    const workflow = this.workflowsOf(repository).find(
      (each) => each.file === workflowId || String(each.id) === workflowId,
    );
    if (workflow === undefined) return notFound();
    const parsed = dispatchBodySchema.safeParse(JSON.parse(body || "null"));
    if (!parsed.success) return unprocessable("Invalid request.");
    const { ref } = parsed.data;
    const inputs = parsed.data.inputs ?? {};
    const name = ref.replace(/^refs\/(heads|tags)\//, "");
    if (!this.hasRef(repository, name)) return unprocessable(`No ref found for: ${ref}`);
    const text = yamlAt(workflow, name);
    const declared = text === undefined ? undefined : dispatchInputsOf(text);
    if (declared === undefined) {
      return unprocessable("Workflow does not have 'workflow_dispatch' trigger");
    }
    const unexpected = Object.keys(inputs).filter(
      (input) => !declared.some((each) => each.name === input),
    );
    if (unexpected.length > 0) {
      return unprocessable(`Unexpected inputs provided: ${JSON.stringify(unexpected)}`);
    }
    const missing = declared.find((input) => input.required && !(input.name in inputs));
    if (missing !== undefined) {
      return unprocessable(`Required input '${missing.name}' not provided`);
    }
    this.accepted.push({ repository, file: workflow.file, ref, inputs });
    this.runs.queueDispatched(repository, workflow.name ?? workflow.file, name);
    return { status: 204, body: undefined };
  }

  private hasRef(repository: string, name: string): boolean {
    const refs = this.refsOf(repository);
    return refs.branches.includes(name) || refs.tags.includes(name);
  }

  private workflowsOf(repository: string): StoredWorkflow[] {
    const key = repository.toLowerCase();
    let stored = this.workflows.get(key);
    if (stored === undefined) {
      stored = [];
      this.workflows.set(key, stored);
    }
    return stored;
  }

  private refsOf(repository: string): Refs {
    const key = repository.toLowerCase();
    let refs = this.refs.get(key);
    if (refs === undefined) {
      refs = { branches: ["main"], tags: [] };
      this.refs.set(key, refs);
    }
    return refs;
  }
}

function pathOf(workflow: FakeWorkflow): string {
  return workflow.path ?? `.github/workflows/${workflow.file}`;
}

/** The workflow's file at the ref, undefined where it isn't. */
function yamlAt(workflow: FakeWorkflow, ref: string): string | undefined {
  return typeof workflow.yaml === "string" ? workflow.yaml : workflow.yaml[ref];
}

/**
 * One page of `all` by GitHub's `per_page` and `page`, with a `Link` header naming the next and
 * last pages while there are more.
 */
function pageOf<T>(
  request: URL,
  all: readonly T[],
  bodyOf: (items: readonly T[]) => unknown,
): ApiAnswer {
  const size = Math.min(
    Number(request.searchParams.get("per_page") ?? DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const number = Number(request.searchParams.get("page") ?? 1);
  const body = bodyOf(all.slice((number - 1) * size, number * size));
  const last = Math.max(1, Math.ceil(all.length / size));
  if (number >= last) return { status: 200, body };
  const linkTo = (page: number, rel: string): string => {
    const url = new URL(request);
    url.searchParams.set("page", String(page));
    return `<${url.href}>; rel="${rel}"`;
  };
  return {
    status: 200,
    body,
    headers: { link: [linkTo(number + 1, "next"), linkTo(last, "last")].join(", ") },
  };
}

function notFound(): ApiAnswer {
  return { status: 404, body: { message: "Not Found" } };
}

function unprocessable(message: string): ApiAnswer {
  return { status: 422, body: { message } };
}
