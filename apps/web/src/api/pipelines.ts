import { queryOptions } from "@tanstack/react-query";
import { pipelineListSchema } from "@the-office/contracts";
import { getFromApi } from "./api-client.ts";

export const pipelineQueries = {
  // The library holds only the built-ins in tier 1, so it never changes while the service runs.
  list: () =>
    queryOptions({
      queryKey: ["pipelines"],
      queryFn: ({ signal }) => getFromApi("/pipelines", pipelineListSchema, signal),
      staleTime: Number.POSITIVE_INFINITY,
    }),
};
