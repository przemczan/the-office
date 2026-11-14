import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account } from "@the-office/contracts";
import { adoptAppearance, onAppearanceChosen } from "@the-office/ui";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ACCOUNT, saveAppearance, userQueries } from "../api/users.ts";
import { useToast } from "./toasts.tsx";

/**
 * Shows the account's palette and density, and keeps it as this browser's cache, which paints the
 * next page before anything renders.
 */
export function adoptAccountAppearance({ appearance }: Account): void {
  adoptAppearance({
    palette: appearance.palette ?? undefined,
    density: appearance.density ?? undefined,
  });
}

/**
 * The signed-in user's palette and density (spec §2.10, per user): the account's is shown, before
 * the shell's first paint, and each one chosen here, in Account › Appearance or the rail's Theme
 * menu, is saved to it.
 */
export function AccountAppearance(): ReactNode {
  const account = useQuery(userQueries.account()).data;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const latestSave = useRef(0);

  useLayoutEffect(() => {
    if (account !== undefined) adoptAccountAppearance(account);
  }, [account]);

  useEffect(
    () =>
      onAppearanceChosen(async ({ palette, density }) => {
        latestSave.current += 1;
        const save = latestSave.current;
        try {
          const saved = await saveAppearance({
            palette: palette ?? null,
            density: density ?? null,
          });
          // Only the latest choice's answer, and no read begun before it, may set what is shown.
          if (save !== latestSave.current) return;
          await queryClient.cancelQueries({ queryKey: ACCOUNT, exact: true });
          queryClient.setQueryData(ACCOUNT, saved);
        } catch (error) {
          showToast(
            `Your appearance couldn't be saved: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    [queryClient, showToast],
  );

  return null;
}
