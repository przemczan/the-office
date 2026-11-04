// The design system's Dialog and Drawer close on a press on their dimmed backdrop. A window in The
// Office closes only by Escape or its Close button, so a press landing on the backdrop itself is
// stopped before the design system's handler sees it. design-system/ stays as exported, hence the
// wrapper rather than an edit there. The conversation's drawer on the Task and Initiative pages is
// the exception, closing on a press outside: a side view with its draft kept, not a window, and
// built apart from these (apps/web/src/surfaces/work/conversation-drawer.tsx).
import type { MouseEvent, ReactNode } from "react";
import {
  Dialog as DesignSystemDialog,
  type DialogProps,
} from "../../../design-system/components/overlays/Dialog.jsx";
import {
  Drawer as DesignSystemDrawer,
  type DrawerProps,
} from "../../../design-system/components/overlays/Drawer.jsx";

export function Dialog(props: DialogProps): ReactNode {
  return (
    <KeepOpenOnBackdropPress inline={props.inline}>
      <DesignSystemDialog {...props} />
    </KeepOpenOnBackdropPress>
  );
}

export function Drawer(props: DrawerProps): ReactNode {
  return (
    <KeepOpenOnBackdropPress inline={props.inline}>
      <DesignSystemDrawer {...props} />
    </KeepOpenOnBackdropPress>
  );
}

function KeepOpenOnBackdropPress({
  inline,
  children,
}: {
  readonly inline: boolean | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const stopBackdropPress = (event: MouseEvent<HTMLDivElement>): void => {
    if (!inline && event.target === event.currentTarget.firstElementChild) event.stopPropagation();
  };
  return (
    <div style={{ display: "contents" }} onClickCapture={stopBackdropPress}>
      {children}
    </div>
  );
}
