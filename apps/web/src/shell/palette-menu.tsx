import { Icon, Menu, PALETTES, PaletteSwatch, useAppearance, type Palette } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { RailItemFace, RailItemTooltip } from "./rail-item.tsx";

const PALETTE_IDS = Object.keys(PALETTES) as Palette[];

/** The palette, chosen from the rail; until one is chosen the system's light or dark is shown. */
export function PaletteMenu(): ReactNode {
  const { palette, choosePalette } = useAppearance();
  const [open, setOpen] = useState(false);
  return (
    <span className="shell-palette-menu">
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
            label: (
              <span className="palette-option">
                {PALETTES[id].name}
                {id === palette && <Icon name="check" size={14} />}
              </span>
            ),
            onSelect: () => choosePalette(id),
          })),
        ]}
      />
    </span>
  );
}
