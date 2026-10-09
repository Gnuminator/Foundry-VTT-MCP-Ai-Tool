### Dashboard

- **React dashboard: focus after the confirm window:** the confirm window now remembers the button
  that started the change before the panel disables it, so on close focus goes to that button, or
  to its drawer while the change still runs and back to the button once it is enabled again. This
  covers Party as well as Handouts; before, Party left focus on the page body. Reveal next in
  Handouts stays disabled until the queue has reloaded, so it never offers the page just revealed.
