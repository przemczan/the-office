import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { SignedOut } from "../api/api-client.ts";
import { ACCOUNT, SIGN_IN_PATH, signOut, signOutDevice } from "../api/users.ts";
import { useToast } from "./toasts.tsx";

/**
 * Which signed-in device to sign out: this one by Sign out in the user menu (no id), or one listed
 * on the account by its id, which may be this one.
 */
export interface SignOutOf {
  readonly id?: string;
  readonly thisDevice: boolean;
}

/**
 * Signs out a signed-in device (spec §2.10). Signing out this one lands on the sign-in page;
 * another one's leaves the account's list read again. A failure says so in a toast; a 401 has
 * already sent the browser to the sign-in page.
 */
export function useSignOut(): UseMutationResult<void, Error, SignOutOf> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: ({ id }: SignOutOf) => (id === undefined ? signOut() : signOutDevice(id)),
    onSuccess: (_, { thisDevice }) => {
      if (thisDevice) void navigate({ to: SIGN_IN_PATH, replace: true });
      else void queryClient.invalidateQueries({ queryKey: ACCOUNT });
    },
    onError: (error) => {
      if (!(error instanceof SignedOut)) showToast(`Not signed out: ${error.message}`);
    },
  });
}
