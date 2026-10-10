### Dashboard

- **Radix set for the React dashboard (UI-04):** the dashboard now takes Radix from the single
  `radix-ui` package instead of three `@radix-ui/react-*` ones, and `web/src/ui` gets styled
  `Tooltip`, `Tabs` and `Popover` on the design tokens (they follow The Veil and respect reduced
  motion). The three icon-only buttons (the "?" after a pane's title and the close buttons of
  drawers and panes) now show a tooltip on hover and when you Tab to them; Escape closes the
  tooltip first and leaves the focus where it was. Their names for screen readers and the test kit
  are unchanged. The screenshot tests stay at zero diffs.
