import {
  DENSITIES,
  Icon,
  Menu,
  PALETTES,
  PaletteSwatch,
  useAppearance,
  type Density,
  type Palette,
} from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { RailItemFace, RailItemTooltip } from "./rail-item.tsx";

const PALETTE_IDS = Object.keys(PALETTES) as Palette[];
const DENSITY_IDS = Object.keys(DENSITIES) as Density[];

/** Fewer rows, more air: each density's icon, in the place of a palette's swatch. */
const DENSITY_ICONS: Record<Density, string> = {
  compact: "rows-4",
  comfortable: "rows-3",
  relaxed: "rows-2",
};

/** A choice's name, with a check when it is the one in use. */
function ThemeChoice({ name, chosen }: { readonly name: string; readonly chosen: boolean }) {
  return (
    <span className="menu-choice">
      {name}
      {chosen && <Icon name="check" size={14} />}
    </span>
  );
}

/**
 * The palette and the density, chosen from the rail as in Settings › Appearance; until a palette
 * is chosen the system's light or dark is shown.
 */
export function ThemeMenu(): ReactNode {
  const { palette, choosePalette, density, chooseDensity } = useAppearance();
  const [open, setOpen] = useState(false);
  return (
    <span className="shell-theme-menu">
      <Menu
        open={open}
        onOpenChange={setOpen}
        align="start"
        width={180}
        trigger={
          // The label would cover the open menu.
          <RailItemTooltip label="Theme" open={open ? false : undefined}>
            <button type="button" className="shell-rail-item" aria-label="Theme">
              <RailItemFace icon="palette" label="Theme" />
            </button>
          </RailItemTooltip>
        }
        items={[
          { heading: "Palette" },
          ...PALETTE_IDS.map((id) => ({
            icon: <PaletteSwatch palette={id} />,
            label: <ThemeChoice name={PALETTES[id].name} chosen={id === palette} />,
            onSelect: () => choosePalette(id),
          })),
          { divider: true },
          { heading: "Density" },
          ...DENSITY_IDS.map((id) => ({
            icon: <Icon name={DENSITY_ICONS[id]} size={14} />,
            label: <ThemeChoice name={DENSITIES[id].name} chosen={id === density} />,
            onSelect: () => chooseDensity(id),
          })),
        ]}
      />
    </span>
  );
}
