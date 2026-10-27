### Dashboard

- **Handout queue reorder is one write:** the up and down arrows on the Handouts drawer now use a
  new `move` action on `plan-page-reveal` (with `position`), so a failed move leaves the queue as it
  was instead of possibly dropping pages. Keyboard focus stays on the moved row's arrow.
