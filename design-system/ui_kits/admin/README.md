# Admin UI kit — NotNullSoft back office

Click-through recreation of a generic NotNullSoft back-office app, composed entirely from the design-system components (`window.NotNullSoftAdminDesignSystem_a508e9`).

There was no existing admin product to copy; these screens are **reference compositions** showing how the system is meant to be assembled. All data is sample data (`data.js`).

- `index.html` — app root: auth state, routing, theme toggle (light/dark persisted), toast stack. Sign out from the sidebar user menu to see Login.
- `Login.jsx` — staff sign-in (accent button is the one ember-filled moment).
- `Shell.jsx` — Sidebar (collapsible) + Topbar (breadcrumbs, ⌘K search, theme, notifications).
- `Dashboard.jsx` — Overview: incident Alert, 4 StatCards, revenue LineChart vs previous period, users DonutChart, signups BarChart, activity Timeline, latest orders table.
- `Users.jsx` — list: tabs, search, role Select, status Tag filters, bulk-action toolbar on selection, sortable DataTable with row Menu, Pagination.
- `UserDetail.jsx` — record page: header with status + actions, StatCards, orders, activity, DescriptionList, usage ProgressBars, suspend Dialog → Toast.
- `AuditLog.jsx` — filters + day-grouped Timeline with diffs; "Details" opens a Drawer with event JSON.
- `Settings.jsx` — tabs (General / Security / Notifications / API keys), label-left settings rows, sticky unsaved-changes bar.
