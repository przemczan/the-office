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
  /** The action's tooltip. */
  readonly title?: string;
  readonly iconLeft?: ReactNode;
  readonly variant?: ButtonProps["variant"];
  readonly size?: ButtonProps["size"];
  readonly loading?: boolean;
  /** Only the action: its menu of other ways stays open to choose from. */
  readonly disabled?: boolean;
  readonly menuWidth?: number;
  /** Given to both halves, such as a colour for the action. */
  readonly className?: string;
  /** Where the menu opens: below the control, or above it, as in a window's bottom bar. */
  readonly menuPlacement?: "below" | "above";
  /** Which edge of the control the menu lines up with: its start, or its end at a page's edge. */
  readonly menuAlign?: "start" | "end";
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
  title,
  iconLeft,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled = false,
  menuWidth = 180,
  className,
  menuPlacement = "below",
  menuAlign = "start",
}: SplitButtonProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div role="group" className="split-button" data-menu-placement={menuPlacement}>
      <Button
        variant={variant}
        size={size}
        className={className}
        title={title}
        iconLeft={iconLeft}
        loading={loading}
        disabled={disabled}
        onClick={onClick}
        style={{ borderStartEndRadius: 0, borderEndEndRadius: 0 }}
      >
        {children}
      </Button>
      {/* Static, so the menu opens under the whole control, from the edge it is aligned with. */}
      <Menu
        open={open}
        onOpenChange={setOpen}
        align={menuAlign}
        width={menuWidth}
        style={{ position: "static" }}
        items={items}
        trigger={
          <Button
            variant={variant}
            size={size}
            className={className}
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
