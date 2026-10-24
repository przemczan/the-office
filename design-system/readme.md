# NotNullSoft Admin Design System

Internal design system for **NotNullSoft back-office applications** — admin panels, operations consoles, dashboards, CRUD tools. It derives from the public **NotNullSoft Design System** (marketing/brand system for NotNullSoft, a senior software engineering studio) and re-tunes it for dense, data-heavy, all-day-use interfaces where legibility beats brand expression.

**Sources**
- NotNullSoft Design System — project `d2f8fb71-0691-4e58-baa7-3172dc13e5fc` (tokens, Geist/Geist Mono/Darker Grotesque fonts, logo set, core components, voice). Fonts and logos were copied from it into `assets/`.
- A local folder named `design-system` was attached during setup but could not be browsed; everything here derives from the project above plus the brief: *"derive from the existing NotNullSoft DS, modify for admin-panel-like apps, add components for metrics etc.; keep some brand colours but readability and clarity matter more."*
- Brief answers: comfortable density, light + dark, neutral UI with brand accent, styled chart primitives, UI kit screens: dashboard, list + detail, settings, audit log, login.

## What changed vs. the brand system
| | Brand (marketing) | Admin |
|---|---|---|
| Neutrals | warm beige Ink + Paper page | near-neutral Gray, `--gray-50` page, white cards |
| Primary button | Ember fill | **Ink** fill (`--primary`); Ember reserved |
| Base type | 16–18px body, 60–112px display | **14px body, 13px dense UI**, 24px page titles, no display sizes |
| Controls | 40px | **32px** (28 sm / 40 lg); table rows 44px |
| Radii | 6 / 10 / 16 | 6 / **8** / **12** |
| Links | ember | ink + underline, ember on hover |
| New | — | status token sets, chart palette, layout tokens, data/chart/overlay components |

---

## CONTENT FUNDAMENTALS
Voice is inherited — **a senior engineer talking to a peer** — but in an admin tool copy is mostly labels, so it gets terser.
- **Person:** the UI addresses the operator as "you" only when necessary ("You have unsaved changes"). Never "I", never "we" inside the product (that's for marketing). System actions are attributed to **System** in logs.
- **Casing:** Sentence case everywhere — page titles, buttons, table headers, menu items. IDs and codes stay as-is in mono (`usr_8f2k1`, `ord_10482`). Write the company as **NotNullSoft**; the wordmark is always lowercase.
- **Buttons:** verb + object, 1–3 words. *Invite user, Export CSV, Suspend user, Reset password, Save changes.* Destructive confirms repeat the verb ("Suspend user", never "OK" / "Yes").
- **Confirmations:** title as a question naming the object ("Suspend Marta Kowalska?"), body says the consequence and the way back ("They lose access immediately. You can reactivate them later.").
- **Toasts:** past tense, object first: "User suspended", "Reset link sent", "Settings saved". Add Undo for reversible actions.
- **Empty states:** say why it's empty + what to do. "No users match these filters — Try removing a filter or searching by email."
- **Numbers:** always real units and comparisons: "$48,210", "+12.4% vs previous 30d", "184 ms", "41 / 50 seats". Thousands separators, tabular figures, right-aligned in tables. Missing value = em dash "—".
- **Time:** relative for recency in lists ("5m ago", "2 days ago"), absolute in details and logs ("20 Oct, 14:02", "14:02 UTC"). State the timezone on audit screens.
- **Banned:** emoji, exclamation marks, "Oops", "Whoops", jokes in errors, "solutions", "seamless". Developer winks from the brand (`// 01`) are **not** used inside admin products.

## VISUAL FOUNDATIONS
- **Colour vibe:** neutral, quiet, high-contrast. ~90% gray/white surfaces, ink text, colour only where it carries meaning (status, data, focus). **Ember `#F23D0F`** is the brand accent: focus ring, active nav icon, active tab underline, checked controls, selected-row tint, chart series 1, the notification dot, and the sign-in button. Never for large fills or body text. Flare orange is a chart colour only.
- **Status colours:** green success, amber warning, crimson danger, blue info, gray neutral — each with `-subtle` (fill), `-border`, solid, and `-fg` (text, ≥4.5:1 on subtle). Crimson (`#C8102E`) is deliberately cooler/darker than Ember so errors never read as brand.
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
- **Set:** [Lucide](https://lucide.dev) via CDN `https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js`, rendered by the `Icon` component at **stroke 1.75**, round caps/joins — same choice as the brand system (no proprietary set exists).
- **Sizes:** 14 in sm buttons/menus, 16 default (nav, buttons, stat labels), 20 in empty states.
- **Colour:** `currentColor`. Nav icons are fg-2, the active one Ember. Status colour only inside status contexts (alerts, toasts, timeline nodes).
- **Usage:** icons support labels; icon-only buttons always have a tooltip/`label`. One icon per button max.
- **No emoji, no icon fonts, no filled/duotone icons.** Unicode only for `×` (tag remove), `…` (truncation), `—` (empty value), `⌘K` hints.
- A handful of tiny glyphs (sort arrows, checkbox tick, select chevron, dialog close) are inline SVG inside components so they render without Lucide loaded.

## LOGO
Files in `assets/logo/` (copied from the brand system): `logo-horizontal*`, `wordmark*`, `mark*` in default / `-dark` / `-on-ember` / `-mono-ink` / `-mono-white`, plus `app-icon.svg`, `app-icon-ink.svg`, `favicon.svg`. In admin products use `<Logo size={20} product="Admin"/>` in the sidebar header (logo + mono product chip) and `<Logo variant="mark"/>` when collapsed.

---

## Index
- `styles.css` — entry point; `@import`s every token file.
- `tokens/` — `fonts.css`, `colors.css` (ramps + light/dark aliases), `charts.css`, `typography.css`, `spacing.css` (incl. control/row/layout sizes), `radius.css`, `elevation.css`, `motion.css` (durations, easing, z-index), `base.css`.
- `assets/fonts/` — Geist, Geist Mono (variable woff2), Darker Grotesque Medium (logo only). SIL OFL.
- `assets/logo/` — logo set.
- `guidelines/` — specimen cards: Colors, Type, Spacing, Brand.
- `components/` — React primitives (see below), one `@dsCard` per folder.
- `ui_kits/admin/` — back-office click-through (Login, Overview, Users, User detail, Audit log, Settings).
- `thumbnail.html`, `SKILL.md`.

## Components
- **core/** — Button, IconButton, Badge, Tag, Avatar, Card, Logo (+ Mark), Icon
- **forms/** — Input (+ Field), Textarea, Select, Checkbox, Radio (+ RadioGroup), Switch, SegmentedControl
- **navigation/** — Sidebar, Topbar, PageHeader, Breadcrumbs, Tabs, Pagination
- **data/** — DataTable, StatCard, DescriptionList, Timeline, ProgressBar
- **charts/** — LineChart, BarChart, DonutChart, Sparkline
- **overlays/** — Dialog, Drawer, Menu, Tooltip
- **feedback/** — Toast, Alert, EmptyState, Skeleton

### Intentional additions (not in the brand system)
- **Avatar** — user tables, audit log and topbar need people.
- **Textarea, SegmentedControl** — notes/reasons fields; chart time-range switching.
- **Sidebar, Topbar, PageHeader, Breadcrumbs, Pagination** — the admin app shell.
- **DataTable, StatCard, DescriptionList, Timeline, ProgressBar** — lists, KPIs, record details, audit trails, quotas.
- **LineChart, BarChart, DonutChart, Sparkline** — requested styled chart primitives (pure SVG, no chart library).
- **Drawer, Menu** — record preview without leaving lists; row and account actions.
- **Alert, EmptyState, Skeleton** — persistent banners, empty tables, loading.
- **Logo / Mark / Icon** — kept from the brand system.
