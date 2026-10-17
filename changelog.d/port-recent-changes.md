### Dashboard

- **Recent Changes on the new dashboard:** the list of changes with Undo is now on the new
  dashboard (`/next/`), in the During and After views. The AI tab shows the AI's guarded changes
  and the Everyone tab (when the bridge has `list-changes`) shows everyone's, with a person filter
  and Redo. Undo works as on the full dashboard: the AI tab asks in the confirm window, the
  Everyone tab plans the undo and asks (just this, everything since, or the advanced rewind), and
  a reveal is undone with the plain undo after its own confirm. The list reloads when a change
  lands, also one made in Foundry (the `gm-change` event). It is a fold card in During and loads
  as its own chunk.
