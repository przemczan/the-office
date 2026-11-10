# 41 · The Graphite and Paper palettes, the densities, skill usage counts

Status: in progress

Run in The Office itself as the Initiative `d2d253ac-1328-46be-ad7d-74a8ddfff267`: each step below is one of its Tasks, which carries the step's plan.

## Goal

In Settings › Appearance the user picks a palette (Light, Dark, Graphite or Paper, or following the system) and a density (Compact, Comfortable or Relaxed). Both are kept in this browser. A palette changes colours only and a density changes spacing and sizes only ([spec 4](../spec/4-ux-direction.md)'s three layers), and every surface reads aliases only, so every palette and density combination looks right everywhere. Wherever skills are listed (Settings › Skills, and the Project skills on a Project's page), each skill shows its skill uses in the last 7 days, on every engine ([spec 2.6](../spec/2.6-skills.md)).

## Definition of Done

- [x] Spec 4, spec 2.6 and the glossary settle the palettes, the densities and skill uses. Check: the Initiative's first Task's Gate.
- [x] Settings › Appearance offers Graphite and Paper with spec 4's values; Graphite shows the dark version of a Project's Icon and Logo, Paper the light one; the choice is kept in this browser. Check: a web test per palette's values and its dark or light side; an e2e test that picks each and reads it after a reload.
- [x] Settings › Appearance offers Compact, Comfortable and Relaxed with spec 4's values, kept in this browser; no surface sets a spacing, control height or text size of its own where a density alias applies. Check: a web test of the values; an e2e test that picks each and reads it after a reload; a screenshot of each surface in Compact and Relaxed.
- [x] The service counts each Skill tool call for the skill the session got under that name, a library skill by its record and a Project skill per Project, on Claude Code and on the OpenAI-compatible API engine, and answers each skill's uses in the last 7 days. A skill the session didn't get from The Office isn't counted. Check: service tests on the scripted engine adapter and on the API engine's fake server, and of the 7-day window's edges.
- [ ] Settings › Skills and the Project skills on a Project's page show each skill's uses in the last 7 days. Check: web tests of both lists; an e2e test that reads a count.
- [ ] `npm run verify` passes. Check: the closing Task's run.

## Read first

- [Spec 4](../spec/4-ux-direction.md), the "Colour, palettes and densities" line; [spec 2.6](../spec/2.6-skills.md), Skill uses and its Defaults.
- `packages/ui/src/appearance/` (the palettes, the density, `appearance-store.ts`, `apply-appearance.ts`).
- The map of each module or surface a step changes.

## Leave out

- A palette or a density per Project, per person or kept on the service.
- Other status or accent colours: all four palettes keep the design system's.
- Uses older than 7 days, a history or a chart of skill uses, and counting skills a session didn't get from The Office.

## Steps

- [x] 1. The spec, the glossary and this file.
- [x] 2. The Graphite and Paper palettes in Settings › Appearance.
      Read: `packages/ui/src/appearance/palettes/`, `apps/web/src/shell/brand-tone.ts`, [UI rules](../spec/4.1-ui-rules.md).
- [x] 3. The service counts skill uses, on both engines.
      Read: `apps/service/src/modules/skills/MAP.md`, `apps/service/src/modules/engine/MAP.md`.
- [x] 4. The densities in Settings › Appearance, followed on every surface.
      Read: `packages/ui/src/appearance/densities/comfortable.css`, `apps/web/src/MAP.md`, each surface's map.
- [ ] 5. The counts in Settings › Skills and on a Project's page.
      Read: `apps/web/src/surfaces/settings/MAP.md`, `apps/web/src/surfaces/projects/MAP.md`.
- [ ] 6. Close: `npm run verify`, the Progress log to the archive, the task set to done here and in the README.

## State

Steps 1 to 4 are done. Spec 4 holds the palettes' and densities' values from the Initiative's `themes.css` (Attachment `a60a1724-e2e6-4a64-ac1a-d4c806d29187`); spec 2.6 defines a Skill use; the glossary has Palette, Density and Skill use.

The appearance (`packages/ui/src/appearance/`): `PALETTES` and `DENSITIES` (`apply-appearance.ts`), a file per palette in `palettes/` (`:root[data-palette]`, colour aliases only) and per density in `densities/` (`[data-density]`, the ten density aliases only, an attribute selector so `DensityPreview` draws at its own density). `applyAppearance` sets `data-theme` (the base), `data-palette` and `data-density` from `the-office.palette` and `the-office.density`, also as the inline script before the first paint; `useAppearance()` gives `palette`, `base`, `chosenPalette`, `density` and the choose functions. `palettes.full.test.ts` and `densities.full.test.ts` compare the files with spec 4. Anything that follows light or dark reads `base`; image versions are the contracts' `ProjectImagePalette`.

Step 3 is done: Engine's `SkillCalled`, Skills' `skill_uses`, `usesInLast7Days` on `GET /skills` and `GET /projects/:id/skills`; the web refetches on `skill.used` but shows nothing yet (step 5).

The densities on every surface: `packages/ui`'s `Card` (`card.tsx`, the kit's frame with its own header and body padded `--pad-card`) and `Button`, `IconButton`, `Input`, `Select`, `SegmentedControl`, `DataTable` (`sized-controls.tsx`, heights on `--control-h`, a table's density a step from the one asked) replace the kit's in `@the-office/ui`. Surface CSS reads an alias only where today's Comfortable value equals it, so Comfortable looks as before (the kit's Card pads 16 × 18 px now, settled with the user); a card or row padded otherwise in Comfortable keeps its fixed size.

Settled with the user, 2026-11-10: Graphite and Paper from `themes.css`; the densities are the three `themes.css` defines; every card pads `--pad-card`, the kit's Card too; a Skill use is a Skill tool call in any session, on both engines; the count covers the last 7 days, rolling; it shows in Settings › Skills and the Project skills on a Project's page.

Traps: the lockup's tone follows the base (`apps/web/src/shell/brand-tone.ts`); `--control-h` is 28 px in Comfortable; the e2e shell walk sets palette and density through local storage, as `colorScheme` emulates only light and dark. A Project skill's count is by its key, so two rows sharing a key show the same count (step 5).

## Progress

- 2026-11-10 · step 1: spec 4 (palettes, densities with values from themes.css), spec 2.6 (Skill uses), the glossary and this file; next, the Graphite and Paper palettes.
- 2026-11-10 · step 2: Graphite and Paper in `packages/ui` with a light or dark base read by images, brand tone and How it looks; Settings and the Theme menu list four palettes; unit and e2e tests; next, the service counts skill uses.
- 2026-11-10 · step 3: Skill calls counted on every engine (Engine's SkillCalled, Skills' skill_uses), usesInLast7Days on GET /skills and GET /projects/:id/skills, skill.used to the web; next, the densities, then the counts in the web.
- 2026-11-10 · step 4: Compact, Comfortable and Relaxed in `packages/ui` and Settings › Appearance, kept in this browser and set before the first paint; the kit's Card, controls and tables follow through ui's wrappers, every surface's CSS reads the density aliases; unit and e2e tests; next, the skill counts in the web.
