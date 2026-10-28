import { projectFilterSchema, type ProjectFilter } from "@the-office/contracts";

/** The Project filter is this browser's, so the desk and the phone can show different Projects. */
export const PROJECT_FILTER_STORAGE_KEY = "the-office.project-filter";

/** The Project filter chosen in this browser, in the shape React's `useSyncExternalStore` reads. */
export interface ProjectFilterStore {
  /** The same value until the filter changes. */
  current(): ProjectFilter;
  choose(filter: ProjectFilter): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the choice in local storage, or for this page alone where storage is blocked. */
export function createProjectFilterStore(): ProjectFilterStore {
  let filter = storedFilter();
  const listeners = new Set<() => void>();

  const update = (next: ProjectFilter): void => {
    filter = next;
    for (const listener of listeners) listener();
  };
  // Another tab chose Projects.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== PROJECT_FILTER_STORAGE_KEY) return;
    update(storedFilter());
  };

  return {
    current: () => filter,
    choose: (next) => {
      try {
        localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage is blocked: the choice lasts until the page is closed.
      }
      update(next);
    },
    subscribe: (onChange) => {
      if (listeners.size === 0) window.addEventListener("storage", onStorage);
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
  };
}

function storedFilter(): ProjectFilter {
  try {
    const stored = localStorage.getItem(PROJECT_FILTER_STORAGE_KEY);
    if (stored === null) return "all";
    const parsed = projectFilterSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : "all";
  } catch {
    return "all";
  }
}
