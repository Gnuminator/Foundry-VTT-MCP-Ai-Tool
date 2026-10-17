### Dashboard

- **Panels that load late (React dashboard):** after a panel failed to load, clicking its button
  again now opens the drawer with the error and a hint to reload, instead of a dimmed page with
  nothing on it. Escape closes the drawer that shows while a panel is still loading. A docked
  panel that has the focus keeps it when the real panel replaces it. (Backlog: lazy-panel-lows-2;
  #356 review L1, L2)
