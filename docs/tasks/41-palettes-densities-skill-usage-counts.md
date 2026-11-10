# 41 · The Graphite and Paper palettes, the densities, skill usage counts

Status: done

Run in The Office itself as the Initiative `d2d253ac-1328-46be-ad7d-74a8ddfff267`: each step below is one of its Tasks, which carries the step's plan.

## Goal

In Settings › Appearance the user picks a palette (Light, Dark, Graphite or Paper, or following the system) and a density (Compact, Comfortable or Relaxed). Both are kept in this browser. A palette changes colours only and a density changes spacing and sizes only ([spec 4](../spec/4-ux-direction.md)'s three layers), and every surface reads aliases only, so every palette and density combination looks right everywhere. Wherever skills are listed (Settings › Skills, and the Project skills on a Project's page), each skill shows its skill uses in the last 7 days, on every engine ([spec 2.6](../spec/2.6-skills.md)).

## Definition of Done

- [x] Spec 4, spec 2.6 and the glossary settle the palettes, the densities and skill uses. Check: the Initiative's first Task's Gate.
- [x] Settings › Appearance offers Graphite and Paper with spec 4's values; Graphite shows the dark version of a Project's Icon and Logo, Paper the light one; the choice is kept in this browser. Check: a web test per palette's values and its dark or light side; an e2e test that picks each and reads it after a reload.
- [x] Settings › Appearance offers Compact, Comfortable and Relaxed with spec 4's values, kept in this browser; no surface sets a spacing, control height or text size of its own where a density alias applies. Check: a web test of the values; an e2e test that picks each and reads it after a reload; a screenshot of each surface in Compact and Relaxed.
- [x] The service counts each Skill tool call for the skill the session got under that name, a library skill by its record and a Project skill per Project, on Claude Code and on the OpenAI-compatible API engine, and answers each skill's uses in the last 7 days. A skill the session didn't get from The Office isn't counted. Check: service tests on the scripted engine adapter and on the API engine's fake server, and of the 7-day window's edges.
- [x] Settings › Skills and the Project skills on a Project's page show each skill's uses in the last 7 days. Check: web tests of both lists; an e2e test that reads a count.
- [x] `npm run verify` passes. Check: the closing Task's run.

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
- [x] 5. The counts in Settings › Skills and on a Project's page.
      Read: `apps/web/src/surfaces/settings/MAP.md`, `apps/web/src/surfaces/projects/MAP.md`.
- [x] 6. Close: `npm run verify`, the Progress log to the archive, the task set to done here and in the README.

## State

Done. In Settings › Appearance the user picks a palette (Light, Dark, Graphite, Paper or Follow the system) and a density (Compact, Comfortable, Relaxed), kept in this browser; Settings › Skills and a Project's skills show each skill's uses in the last 7 days.

- The appearance: `packages/ui/src/appearance/` (`PALETTES`, `DENSITIES`, `applyAppearance`, `useAppearance`), a file per palette in `palettes/` and per density in `densities/`, checked against spec 4 by `palettes.full.test.ts` and `densities.full.test.ts`. The kit's Card and sized controls follow the density through `packages/ui`'s wrappers (`card.tsx`, `sized-controls.tsx`); every surface's CSS reads the density aliases.
- Skill uses: Engine's `EngineSessions` publishes `SkillCalled` for each `Skill` call on any engine; Skills' `SkillUses` keeps it in `skill_uses` (pruned daily) and announces `skill.used`; `GET /skills` and `GET /projects/:id/skills` give `usesInLast7Days`, shown in `skillUsesLabel`'s words (`apps/web/src/shell/skill-uses.ts`).
- The e2e checks are `@full`: `settings.e2e.ts` (Appearance), `shell.e2e.ts` (each surface in Compact and Relaxed) and the last test of `people.e2e.ts` (a skill's count).

## Progress

The log is in [archive/41-palettes-densities-skill-usage-counts.md](archive/41-palettes-densities-skill-usage-counts.md).
