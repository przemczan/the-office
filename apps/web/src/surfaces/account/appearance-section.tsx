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
import { usePageHeading } from "../../shell/page-heading.tsx";
import { AccountCardTitle } from "./account-card-title.tsx";

const PALETTE_IDS = Object.keys(PALETTES) as Palette[];
const DENSITY_IDS = Object.keys(DENSITIES) as Density[];

/**
 * Account › Appearance: the palette, or the system's light or dark, and the density; each kept for
 * the signed-in user, on every browser they sign in on.
 */
export function AppearanceSection(): ReactNode {
  usePageHeading({ title: "Account", crumb: "Appearance" });
  const { chosenPalette, choosePalette, followSystem, density, chooseDensity } = useAppearance();

  return (
    <div className="account-cards">
      <Card title={<AccountCardTitle icon="palette">Palette</AccountCardTitle>}>
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
        <p className="account-note appearance-note">
          A palette changes colours only, never the layout. It is yours: it follows you to every
          browser you sign in on.
        </p>
      </Card>
      <Card title={<AccountCardTitle icon="rows-3">Density</AccountCardTitle>}>
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
        <p className="account-note appearance-note">
          A density changes spacing and sizes only, never the colours. It is yours: it follows you
          to every browser you sign in on.
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
