import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import type { ReactNode } from "react";
import { changeTags, TASKS, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { tagsInUse } from "./tag-words.ts";
import { TagsInput } from "./tags-input.tsx";

/** The Task's Tags on its page, saved as each is added or removed, in any state. */
export function TaskTags({ task }: { readonly task: Task }): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const tasks = useQuery(taskQueries.list());
  const saving = useMutation({
    mutationFn: (tags: readonly string[]) => changeTags(task.id, tags),
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TASKS }),
  });
  return (
    <TagsInput
      tags={saving.isPending ? saving.variables : task.tags}
      suggestions={tagsInUse(tasks.data ?? [])}
      onChange={(tags) => saving.mutate(tags)}
    />
  );
}
