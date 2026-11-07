import { useQuery } from "@tanstack/react-query";
import { Avatar, type AvatarProps } from "@the-office/ui";
import type { ReactNode } from "react";
import { avatarAddress, roleQueries } from "../api/people.ts";
import { useShownImage } from "./shown-image.ts";

/**
 * A person as they are drawn everywhere: their Avatar, or their initials and tint when they have
 * none or it can't be loaded. Found by Role key, as two people can share a name.
 */
export function PersonAvatar({
  roleKey,
  name,
  size,
}: {
  readonly roleKey: string;
  readonly name: string;
  readonly size: AvatarProps["size"];
}): ReactNode {
  const avatar = useQuery({
    ...roleQueries.list(),
    // People's events keep the list fresh, so a Thread's every new message needn't refetch it.
    staleTime: Infinity,
    select: (roles) => roles.find(({ key }) => key === roleKey)?.avatar,
  }).data;
  const { address, onError } = useShownImage(
    avatar ? avatarAddress(roleKey, avatar.id) : undefined,
  );
  return <Avatar name={name} size={size} src={address} onImageError={onError} />;
}
