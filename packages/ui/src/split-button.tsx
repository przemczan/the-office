import { useState, type ReactNode } from "react";
import type { ButtonProps } from "../../../design-system/components/core/Button.jsx";
import { Icon } from "../../../design-system/components/core/Icon.jsx";
import { Menu, type MenuItem } from "../../../design-system/components/overlays/Menu.jsx";
import { Button } from "./sized-controls.tsx";

export interface SplitButtonProps {
  readonly children: ReactNode;
  readonly onClick: () => void;
  /** The other ways to do it, in the menu the arrow opens. */
  readonly items: MenuItem[];
  /** What the arrow is called, as it shows no words, such as "More ways to move up". */
  readonly menuLabel: string;
  readonly iconLeft?: ReactNode;
  readonly variant?: ButtonProps["variant"];
  readonly size?: ButtonProps["size"];
  readonly loading?: boolean;
  readonly menuWidth?: number;
}

const ARROW_PADDING = { sm: "0 6px", md: "0 8px", lg: "0 10px" } as const;

/**
 * A button joined to an arrow that opens a menu of other ways to do the same thing. The design
 * system has no split button, hence this here; both halves are its Button, and the menu its Menu.
 */
export function SplitButton({
  children,
  onClick,
  items,
  menuLabel,
  iconLeft,
  variant = "secondary",
  size = "md",
  loading = false,
  menuWidth = 180,
}: SplitButtonProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div role="group" className="split-button">
      <Button
        variant={variant}
        size={size}
        iconLeft={iconLeft}
        loading={loading}
        onClick={onClick}
        style={{ borderStartEndRadius: 0, borderEndEndRadius: 0 }}
      >
        {children}
      </Button>
      {/* Static, so the menu opens under the whole control, from its start. */}
      <Menu
        open={open}
        onOpenChange={setOpen}
        align="start"
        width={menuWidth}
        style={{ position: "static" }}
        items={items}
        trigger={
          <Button
            variant={variant}
            size={size}
            disabled={loading}
            aria-label={menuLabel}
            title={menuLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            style={{
              padding: ARROW_PADDING[size],
              borderStartStartRadius: 0,
              borderEndStartRadius: 0,
            }}
          >
            <Icon name="chevron-down" size={14} />
          </Button>
        }
      />
    </div>
  );
}
