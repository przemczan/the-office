# 41 · The Graphite and Paper palettes, the densities, skill usage counts

Status: in progress

Run in The Office itself as the Initiative `d2d253ac-1328-46be-ad7d-74a8ddfff267`: each step below is one of its Tasks, which carries the step's plan.

## Goal

In Settings › Appearance the user picks a palette (Light, Dark, Graphite or Paper, or following the system) and a density (Compact, Comfortable or Relaxed). Both are kept in this browser. A palette changes colours only and a density changes spacing and sizes only ([spec 4](../spec/4-ux-direction.md)'s three layers), and every surface reads aliases only, so every palette and density combination looks right everywhere. Wherever skills are listed (Settings › Skills, and the Project skills on a Project's page), each skill shows its skill uses in the last 7 days, on every engine ([spec 2.6](../spec/2.6-skills.md)).

## Definition of Done

- [x] Spec 4, spec 2.6 and the glossary settle the palettes, the densities and skill uses. Check: the Initiative's first Task's Gate.
- [x] Settings › Appearance offers Graphite and Paper with spec 4's values; Graphite shows the dark version of a Project's Icon and Logo, Paper the light one; the choice is kept in this browser. Check: a web test per palette's values and its dark or light side; an e2e test that picks each and reads it after a reload.
- [ ] Settings › Appearance offers Compact, Comfortable and Relaxed with spec 4's values, kept in this browser; no surface sets a spacing, control height or text size of its own where a density alias applies. Check: a web test of the values; an e2e test that picks each and reads it after a reload; a screenshot of each surface in Compact and Relaxed.
- [ ] The service counts each Skill tool call for the skill the session got under that name, a library skill by its record and a Project skill per Project, on Claude Code and on the OpenAI-compatible API engine, and answers each skill's uses in the last 7 days. A skill the session didn't get from The Office isn't counted. Check: service tests on the scripted engine adapter and on the API engine's fake server, and of the 7-day window's edges.
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
- [ ] 3. The service counts skill uses, on both engines.
      Read: `apps/service/src/modules/skills/MAP.md`, `apps/service/src/modules/engine/MAP.md`.
- [ ] 4. The densities in Settings › Appearance, followed on every surface.
      Read: `packages/ui/src/appearance/densities/comfortable.css`, `apps/web/src/MAP.md`, each surface's map.
- [ ] 5. The counts in Settings › Skills and on a Project's page.
      Read: `apps/web/src/surfaces/settings/MAP.md`, `apps/web/src/surfaces/projects/MAP.md`.
- [ ] 6. Close: `npm run verify`, the Progress log to the archive, the task set to done here and in the README.

## State

Steps 1 and 2 are done. Spec 4 holds the palettes' and densities' values from the Initiative's `themes.css` (Attachment `a60a1724-e2e6-4a64-ac1a-d4c806d29187`); spec 2.6 defines a Skill use; the glossary has Palette, Density and Skill use.

The palettes: `packages/ui/src/appearance/palettes/` has a file per palette (`:root[data-palette="…"]` remapping colour aliases, then its swatch and preview colours as `--palette-<id>-page/-border/-line`), and `PALETTES` (`apply-appearance.ts`) lists each with its name and base. `data-theme` is the base (light or dark), `data-palette` the palette; `useAppearance()` gives both, as `palette` and `base`. Anything that follows light or dark (an Icon's or a Logo's version, the lockup's tone, How it looks' first stage) reads `base`; image versions are the contracts' `ProjectImagePalette`, never ui's `Palette`. `palettes.full.test.ts` compares Graphite's and Paper's files with spec 4.

Settled with the user, 2026-11-10: Graphite and Paper from `themes.css`; the densities are the three `themes.css` defines; a Skill use is a Skill tool call in any session, on both engines; the count covers the last 7 days, rolling; it shows in Settings › Skills and the Project skills on a Project's page.

Traps for the density step:

- `--brand-ink` and `--brand-ember` aren't ported: the lockup's tone follows the base (`apps/web/src/shell/brand-tone.ts`), which gives Graphite's light ink.
- `--control-h` is 28 px in Comfortable, where the design system's spacing card says 32; spec 4 keeps 28.
- The e2e shell walk opens Graphite and Paper through local storage (`the-office.palette`), as `colorScheme` emulates only light and dark.

## Progress

- 2026-11-10 · step 1: spec 4 (palettes, densities with values from themes.css), spec 2.6 (Skill uses), the glossary and this file; next, the Graphite and Paper palettes.
- 2026-11-10 · step 2: Graphite and Paper in `packages/ui` with a light or dark base read by images, brand tone and How it looks; Settings and the Theme menu list four palettes; unit and e2e tests; next, the service counts skill uses.
