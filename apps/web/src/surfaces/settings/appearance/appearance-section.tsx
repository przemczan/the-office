import { Card, Icon, PALETTES, PalettePreview, useAppearance, type Palette } from "@the-office/ui";
import type { ReactNode } from "react";
import { usePageHeading } from "../../../shell/page-heading.tsx";

const PALETTE_IDS = Object.keys(PALETTES) as Palette[];

/** Settings › Appearance: the palette, or the system's light or dark; kept in this browser. */
export function AppearanceSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Appearance" });
  const { chosenPalette, choosePalette, followSystem } = useAppearance();
  return (
    <Card
      title={
        <span className="settings-block-title">
          <Icon name="palette" size={15} strokeWidth={1.6} />
          Palette
        </span>
      }
    >
      <div className="palette-cards" role="group" aria-label="Palette">
        {PALETTE_IDS.map((id) => (
          <PaletteCard
            key={id}
            preview={id}
            label={PALETTES[id].name}
            chosen={chosenPalette === id}
            onChoose={() => choosePalette(id)}
          />
        ))}
        <PaletteCard
          preview="system"
          label="Follow the system"
          chosen={chosenPalette === undefined}
          onChoose={followSystem}
        />
      </div>
      <p className="settings-note palette-note">
        A palette changes colours only, never the layout. It stays in this browser.
      </p>
    </Card>
  );
}

function PaletteCard({
  preview,
  label,
  chosen,
  onChoose,
}: {
  readonly preview: Palette | "system";
  readonly label: string;
  readonly chosen: boolean;
  readonly onChoose: () => void;
}): ReactNode {
  return (
    <button type="button" aria-pressed={chosen} className="palette-card" onClick={onChoose}>
      <PalettePreview palette={preview} />
      {label}
    </button>
  );
}
