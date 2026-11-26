import type { ElkLayout } from "./flow-auto-align.ts";

/**
 * elkjs for Auto-align in the browser: its API and its worker are loaded on the first press, by
 * dynamic imports, so neither is part of the main bundle, and the layout runs in a Web Worker so
 * the page never stalls. A worker that fails to load fails the layout, and the next press loads it
 * afresh.
 */

let loading: Promise<ElkLayout> | undefined;

export function elkInWorker(): Promise<ElkLayout> {
  loading ??= loaded().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function loaded(): Promise<ElkLayout> {
  const [{ default: Elk }, { default: workerUrl }] = await Promise.all([
    import("elkjs/lib/elk-api.js"),
    import("elkjs/lib/elk-worker.min.js?url"),
  ]);
  const worker = new Worker(workerUrl);
  const failed = new Promise<never>((_, reject) => {
    worker.addEventListener("error", () => reject(new Error("elkjs's worker didn't load")), {
      once: true,
    });
  });
  // Raced by each layout; one that fails before any is asked for is still caught there.
  failed.catch(() => undefined);
  const elk = new Elk({ workerUrl, workerFactory: () => worker });
  return {
    layout: async (graph) => {
      try {
        return await Promise.race([elk.layout(graph), failed]);
      } catch (error) {
        worker.terminate();
        loading = undefined;
        throw error;
      }
    },
  };
}
