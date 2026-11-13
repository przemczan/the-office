import type { SignInWay, SignInWayKind } from "@the-office/contracts";
import { Fragment, type ReactNode } from "react";
import { PasswordWay } from "./password-way.tsx";

/** What draws one kind of way to sign in, given that way as the service listed it. */
export type SignInWayView<Kind extends SignInWayKind> = (props: {
  readonly way: Extract<SignInWay, { readonly kind: Kind }>;
}) => ReactNode;

/**
 * Each way to sign in by its kind. Every kind the contract's union has needs its entry, so a way a
 * later Task adds (Continue with GitHub, Continue with Google, a passkey) can't be left undrawn.
 */
export const SIGN_IN_WAYS: { readonly [Kind in SignInWayKind]: SignInWayView<Kind> } = {
  password: PasswordWay,
};

/** The ways the service listed for this address, each drawn by its kind, in the service's order. */
export function SignInWays({ ways }: { readonly ways: readonly SignInWay[] }): ReactNode {
  return ways.map((way) => <Fragment key={way.kind}>{wayView(way)}</Fragment>);
}

function wayView<Kind extends SignInWayKind>(
  way: Extract<SignInWay, { readonly kind: Kind }>,
): ReactNode {
  const View = SIGN_IN_WAYS[way.kind as Kind] as SignInWayView<Kind>;
  return <View way={way} />;
}
