// Checked by tsc: the components carry the types of their .d.ts files, not `any`.
import type { JSX } from "react";
import { expectTypeOf } from "vitest";
import { Button, Icon } from "./index.ts";

expectTypeOf(Button).returns.toEqualTypeOf<JSX.Element>();

// @ts-expect-error: not one of Button's variants.
export const unknownVariant = <Button variant="link">Save changes</Button>;

// @ts-expect-error: Icon needs the name of a Lucide icon.
export const unnamedIcon = <Icon />;
