# 03 · Web shell: design system, themes and A3 · Desk

Status: done

## Goal

The web app every surface lives in: the design system available as typed React components, the theme layers with Light and Dark, and the A3 · Desk shell from the click-through (rail, top bar, status strip frame, panels), with routing, the API client and the WebSocket connection. Surfaces fill it from task 04 on.

## Definition of Done

- [x] `apps/web` imports every design-system component from `packages/ui`, typed by the shipped `.d.ts`; nothing in `apps/web` imports `design-system/` directly. Check: `npm run verify` with the adherence lint on `apps/web`.
- [x] The shell matches the click-through's A3 · Desk at full width, two panels and one panel. Check: Playwright screenshots of the shell at three widths, side by side with the click-through's.
- [x] Light and Dark switch at runtime and follow the system by default; components use aliases only. Check: Playwright screenshots in both themes; a grep for raw colours in `apps/web` finds none.
- [x] The rail links to the five surfaces; Now, Work, People, Projects and Settings each render an empty page with its title. Check: Playwright walks the rail.
- [x] The web reconnects to the WebSocket after the service restarts, and shows that it is reconnecting. Check: restart the service with the page open.

## Read first

- [Spec §4](../spec/4-ux-direction.md).
- [design-system/readme.md](../../design-system/readme.md): content fundamentals, visual foundations, iconography, components.
- Click-through: [prototypes/shell-a3.html](../../.scratch/the-office/prototypes/shell-a3.html) and the shell in [app/core.js](../../.scratch/the-office/prototypes/app/core.js) and [app/app.css](../../.scratch/the-office/prototypes/app/app.css); open [app/index.html](../../.scratch/the-office/prototypes/app/index.html) in a browser.
- Themes: [prototypes/themes.md](../../.scratch/the-office/prototypes/themes.md) and [app/themes.css](../../.scratch/the-office/prototypes/app/themes.css).
- Brand: [design-system/guidelines/brand-admin-lockup.html](../../design-system/guidelines/brand-admin-lockup.html).

Build from the shell: the rail, the top bar with the title and "Idea" (the button opens nothing until task 10), the status strip as a frame with no figures yet (task 16 fills it), and the three-panel layout with its folding. Leave out: search, the fire alarm and the alarm state in the strip, the Project filter, the Graphite and Paper palettes and the densities.

## Steps

- [x] 1. `packages/ui`: an `index.ts` barrel that re-exports each component from `design-system/components/**` with its `.d.ts` types, the fonts and `design-system/styles.css`, and Vite and TypeScript settings that compile the `.jsx` files from outside `apps/web`. Point the adherence lint's import rule at the barrel. Commit.
- [x] 2. Theme layers in `packages/ui`: design-system tokens untouched; a palette layer remapping colour aliases only (Light, Dark as dark gray, the muted text and surfaces with full-strength status colours of [themes.md](../../.scratch/the-office/prototypes/themes.md)); a density layer for spacing aliases with Comfortable only; the theme set on `<html>`, following the system until chosen, the choice kept in local storage. Commit.
- [x] 3. `apps/web`: Vite, React, TanStack Router with a route per surface, TanStack Query with an API client typed by `packages/contracts`, and a WebSocket client that reconnects and invalidates queries from domain events. The service serves the built web app; `npm run dev` runs both. Commit.
- [x] 4. The shell: rail, top bar with the lockup and "Idea", the status strip frame, the panels and their folding, the coloured left edge of cards by type or status, and the five empty surface pages. Commit.
- [x] 5. Playwright: a smoke test that walks the rail in both themes and at three widths, saving screenshots for review. Commit.

## Progress

The log is archived in [archive/03-web-shell.md](archive/03-web-shell.md).
