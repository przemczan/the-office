import {
  Card,
  DENSITIES,
  DensityPreview,
  PALETTES,
  PalettePreview,
  useAppearance,
  type Density,
  type Palette,
} from "@the-office/ui";
import type { ReactNode } from "react";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { SettingsCardTitle } from "../settings-card-parts.tsx";

const PALETTE_IDS = Object.keys(PALETTES) as Palette[];
const DENSITY_IDS = Object.keys(DENSITIES) as Density[];

/**
 * Settings › Appearance: the palette, or the system's light or dark, and the density; each kept in
 * this browser.
 */
export function AppearanceSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Appearance" });
  const { chosenPalette, choosePalette, followSystem, density, chooseDensity } = useAppearance();

  return (
    <div className="appearance-cards">
      <Card title={<SettingsCardTitle icon="palette">Palette</SettingsCardTitle>}>
        <div className="appearance-choices" role="group" aria-label="Palette">
          {PALETTE_IDS.map((id) => (
            <AppearanceChoice
              key={id}
              preview={<PalettePreview palette={id} />}
              label={PALETTES[id].name}
              chosen={chosenPalette === id}
              onChoose={() => choosePalette(id)}
            />
          ))}
          <AppearanceChoice
            preview={<PalettePreview palette="system" />}
            label="Follow the system"
            chosen={chosenPalette === undefined}
            onChoose={followSystem}
          />
        </div>
        <p className="settings-note appearance-note">
          A palette changes colours only, never the layout. It stays in this browser.
        </p>
      </Card>
      <Card title={<SettingsCardTitle icon="rows-3">Density</SettingsCardTitle>}>
        <div className="appearance-choices" role="group" aria-label="Density">
          {DENSITY_IDS.map((id) => (
            <AppearanceChoice
              key={id}
              preview={<DensityPreview density={id} />}
              label={DENSITIES[id].name}
              chosen={density === id}
              onChoose={() => chooseDensity(id)}
            />
          ))}
        </div>
        <p className="settings-note appearance-note">
          A density changes spacing and sizes only, never the colours. It stays in this browser.
        </p>
      </Card>
    </div>
  );
}

function AppearanceChoice({
  preview,
  label,
  chosen,
  onChoose,
}: {
  readonly preview: ReactNode;
  readonly label: string;
  readonly chosen: boolean;
  readonly onChoose: () => void;
}): ReactNode {
  return (
    <button type="button" aria-pressed={chosen} className="appearance-choice" onClick={onChoose}>
      {preview}
      {label}
    </button>
  );
}
