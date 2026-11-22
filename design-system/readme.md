# The Office design system

The design system of **The Office**: tokens, fonts and React components for dense, data-heavy, all-day-use screens where legibility comes first. The app imports it through `packages/ui`, which wraps the components rather than editing them.

**Brand:** The Office's mark, the building at the top of the rail, is the brand, with **Ember** as its accent. The design system has no brand of its own.

---

## CONTENT FUNDAMENTALS
The voice is **a senior engineer talking to a peer**, but in the app copy is mostly labels, so it stays terse.
- **Person:** the UI addresses the operator as "you" only when necessary ("You have unsaved changes"). Never "I", never "we" inside the product (that's for marketing). System actions are attributed to **System** in logs.
- **Casing:** Sentence case everywhere — page titles, buttons, table headers, menu items. IDs and codes stay as-is in mono (`usr_8f2k1`, `ord_10482`).
- **Buttons:** verb + object, 1–3 words. *Invite user, Export CSV, Suspend user, Reset password, Save changes.* Destructive confirms repeat the verb ("Suspend user", never "OK" / "Yes").
- **Confirmations:** title as a question naming the object ("Suspend Marta Kowalska?"), body says the consequence and the way back ("They lose access immediately. You can reactivate them later.").
- **Toasts:** past tense, object first: "User suspended", "Reset link sent", "Settings saved". Add Undo for reversible actions.
- **Empty states:** say why it's empty + what to do. "No users match these filters — Try removing a filter or searching by email."
- **Numbers:** always real units and comparisons: "$48,210", "+12.4% vs previous 30d", "184 ms", "41 / 50 seats". Thousands separators, tabular figures, right-aligned in tables. Missing value = em dash "—".
- **Time:** relative for recency in lists ("5m ago", "2 days ago"), absolute in details and logs ("20 Oct, 14:02", "14:02 UTC"). State the timezone on audit screens.
- **Banned:** emoji, exclamation marks, "Oops", "Whoops", jokes in errors, "solutions", "seamless", developer winks (`// 01`).

## VISUAL FOUNDATIONS
- **Colour vibe:** neutral, quiet, high-contrast. ~90% gray/white surfaces, ink text, colour only where it carries meaning (status, data, focus). **Ember `#F23D0F`** is the accent: focus ring, active nav icon, active tab underline, checked controls, selected-row tint, chart series 1, the notification dot, and the sign-in button. Never for large fills or body text. Flare orange is a chart colour only.
- **Status colours:** green success, amber warning, crimson danger, blue info, gray neutral — each with `-subtle` (fill), `-border`, solid, and `-fg` (text, ≥4.5:1 on subtle). Crimson (`#C8102E`) is deliberately cooler/darker than Ember so errors never read as the accent.
- **Type:** Geist for everything, Geist Mono for IDs, codes, timestamps, keyboard hints and 11px uppercase overlines (sidebar section labels). Page title 24/600, section 16/600, card title 14/600, body 14/400, dense UI 13. Tight tracking (−1.5%) only on titles and metrics. **Tabular numerals** on every number that aligns.
- **Spacing:** 4px base. Inside controls 6–12px, between controls 8px, between cards 16px, page padding 24px, card padding 20px. Comfortable density: 32px controls, 44px rows (36 compact / 52 relaxed).
- **Backgrounds:** flat. Page `--bg` (gray-50), cards white. No gradients, textures, illustrations or imagery in product chrome. The only gradient is the skeleton shimmer.
- **Borders:** 1px hairlines do the structural work — cards, table rows (`--border-subtle`), header dividers. Inputs use `--border-strong` + shadow-1.
- **Cards:** white, 1px border, 8px radius, **no shadow**. Title row inside; `padding="none"` for tables puts a divider under the header. No coloured left borders, no tinted card backgrounds.
- **Shadows:** cool-black, low. shadow-1 on inputs/secondary buttons, shadow-2 raised panels (login card), shadow-3 for anything floating: menus, tooltips, dialogs, drawers, toasts, chart tooltips. In dark mode shadows add a white 1px ring.
- **Radii:** 4 badges/tooltips, 6 controls, 8 cards/menus, 12 dialogs and login card, pills only for filter Tags and Switches, circles for avatars and status dots.
- **Hover:** background tint, never opacity. Ghost/secondary → `--control-hover`; primary ink → gray-700; table rows → `--surface-hover`; danger-ghost → danger-subtle.
- **Press:** one step darker + 1px translateY on buttons. No scale, no bounce.
- **Focus:** ember border + 3px 30% ember ring (`--focus-ring`) on every focusable control.
- **Selection:** selected rows get `--surface-selected` (ember-50). Checked checkbox/radio/switch = ember.
- **Motion:** fast and functional — 80ms press, 120ms hover/colour, 200ms menus & switches, 280ms drawers. `--ease-out`. Drawer slides 24px + fade; dialogs simply appear over overlay. No decorative animation.
- **Transparency & blur:** sticky topbar (surface @88% + 10px blur) and dialog/drawer overlay (gray-950 @45%). Nowhere else.
- **Layout:** fixed 240px sidebar (56px collapsed) + 56px sticky topbar; content max 1440px. Page = PageHeader (title, description, actions, tabs) → filters/toolbar → content cards. Dashboards: 4 KPI tiles, then 2:1 chart grid. Detail pages: 2:1 with a details column on the right. Settings: label-left/controls-right rows.
- **Charts:** fixed categorical order (ember, blue, teal, flare, violet, gray). Comparison periods = gray dashed line. Gridlines dashed hairlines, axis labels 11px fg-3, flat 8% area fills, rounded 2px bar tops, hover crosshair + floating tooltip.
- **Dark mode:** `data-theme="dark"` on `<html>` remaps every alias. Primary button inverts to light; Ember stays the same hue.
- **Imagery:** none in chrome. Avatars fall back to tinted initials.

## ICONOGRAPHY
- **Set:** [Lucide](https://lucide.dev) via CDN `https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js`, rendered by the `Icon` component at **stroke 1.75**, round caps/joins.
- **Sizes:** 14 in sm buttons/menus, 16 default (nav, buttons, stat labels), 20 in empty states.
- **Colour:** `currentColor`. Nav icons are fg-2, the active one Ember. Status colour only inside status contexts (alerts, toasts, timeline nodes).
- **Usage:** icons support labels; icon-only buttons always have a tooltip/`label`. One icon per button max.
- **No emoji, no icon fonts, no filled/duotone icons.** Unicode only for `×` (tag remove), `…` (truncation), `—` (empty value), `⌘K` hints.
- A handful of tiny glyphs (sort arrows, checkbox tick, select chevron, dialog close) are inline SVG inside components so they render without Lucide loaded.

---

## Index
- `styles.css` — entry point; `@import`s every token file.
- `tokens/` — `fonts.css`, `colors.css` (ramps + light/dark aliases), `charts.css`, `typography.css`, `spacing.css` (incl. control/row/layout sizes), `radius.css`, `elevation.css`, `motion.css` (durations, easing, z-index), `base.css`.
- `assets/fonts/` — Geist, Geist Mono (variable woff2). SIL OFL.
- `assets/logo/favicon.svg` — The Office's building mark, the browser tab's icon.
- `components/` — React primitives (see below), each a `.jsx` with its `.d.ts` and a `.prompt.md` usage note.
- `_adherence.oxlintrc.json` — the lint rules that keep the app on the tokens and the components' declared props.

## Components
- **core/** — Button, IconButton, Badge, Tag, Avatar, Card, Icon
- **forms/** — Input (+ Field), Textarea, Select, Checkbox, Radio (+ RadioGroup), Switch, SegmentedControl
- **navigation/** — Sidebar, Topbar, PageHeader, Breadcrumbs, Tabs, Pagination
- **data/** — DataTable, StatCard, DescriptionList, Timeline, ProgressBar
- **charts/** — LineChart, BarChart, DonutChart, Sparkline
- **overlays/** — Dialog, Drawer, Menu, Tooltip
- **feedback/** — Toast, Alert, EmptyState, Skeleton
