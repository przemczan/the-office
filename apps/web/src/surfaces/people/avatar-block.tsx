import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@the-office/contracts";
import type { ReactNode } from "react";
import { removeAvatar, roleQueries, uploadAvatar } from "../../api/people.ts";
import { IMAGE_LIMIT_IN_MB, ImageRow, ImageRowEmpty } from "../../shell/image-row.tsx";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { PersonBlock } from "./role-card-layout.tsx";

/** The person's picture; someone let go keeps theirs, and can't change it until hired back. */
export function AvatarBlock({ role }: { readonly role: Role }): ReactNode {
  const { name } = role.card;
  const letGo = role.letGoAt !== null;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const changing = useMutation({
    mutationFn: (file: File | null) =>
      file === null ? removeAvatar(role.key) : uploadAvatar(role.key, file),
    onSuccess: async (saved, file) => {
      queryClient.setQueryData(roleQueries.one(saved.key).queryKey, saved);
      await queryClient.invalidateQueries(roleQueries.list());
      showToast(`Avatar ${file ? "saved" : "removed"} for ${name}.`);
    },
  });
  return (
    <PersonBlock icon="image" title="Avatar">
      <ImageRow
        name="Avatar"
        hint={
          letGo
            ? `Hire ${name} back to change it.`
            : `PNG, JPEG, WebP or SVG, at most ${IMAGE_LIMIT_IN_MB} MB`
        }
        preview={
          role.avatar ? (
            <PersonAvatar roleKey={role.key} name={name} size="xl" />
          ) : (
            <ImageRowEmpty name="Avatar" />
          )
        }
        held={role.avatar !== null}
        changing={changing}
        readOnly={letGo}
      />
    </PersonBlock>
  );
}
