import type { LinkProps } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/** What the top bar names the open page by, when its route's title isn't enough. */
export interface PageHeading {
  readonly title: string;
  /** Beside the title, such as "3 Projects", or the page's own name under its parent. */
  readonly crumb?: string;
  /** The page this one is in, linked before the crumb: "Projects › Admin panel". */
  readonly parent?: { readonly label: string; readonly to: NonNullable<LinkProps["to"]> };
}

type SetPageHeading = Dispatch<SetStateAction<PageHeading | undefined>>;

const PageHeadingContext = createContext<SetPageHeading | undefined>(undefined);

/** Holds the heading the open page gives, for the shell's top bar. */
export function usePageHeadingState(): readonly [PageHeading | undefined, SetPageHeading] {
  return useState<PageHeading>();
}

export function PageHeadingProvider({
  setPageHeading,
  children,
}: {
  readonly setPageHeading: SetPageHeading;
  readonly children: ReactNode;
}): ReactNode {
  return <PageHeadingContext value={setPageHeading}>{children}</PageHeadingContext>;
}

/** Names the open page in the top bar while it is shown; its route's title comes back after. */
export function usePageHeading({ title, crumb, parent }: PageHeading): void {
  const setPageHeading = useContext(PageHeadingContext);
  if (setPageHeading === undefined) {
    throw new Error("usePageHeading needs the shell's PageHeadingProvider.");
  }
  const parentLabel = parent?.label;
  const parentTo = parent?.to;
  // Before paint, so the top bar never shows the route's title first. Primitives only, so the
  // shell's re-render this causes doesn't set it again.
  useLayoutEffect(() => {
    setPageHeading({
      title,
      crumb,
      parent:
        parentLabel === undefined || parentTo === undefined
          ? undefined
          : { label: parentLabel, to: parentTo },
    });
    return () => setPageHeading(undefined);
  }, [setPageHeading, title, crumb, parentLabel, parentTo]);
}
