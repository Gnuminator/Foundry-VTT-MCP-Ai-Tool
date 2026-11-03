### Dashboard

- **Live window and GM page say why they are empty:** when the strip does not answer inside
  Foundry, the Live window now lists the address it tried and the usual fixes, with a Try again
  button, instead of a blank frame. Pre-flight warns when `DASHBOARD_FOUNDRY_URL` is not set. The
  GM page banner sits in its own row above the panes, not over Foundry.

### Module

- **GM page map picks no longer need the Live window address:** the module finds the GM page from
  the page that frames Foundry, so picks and "connected" work with the setting empty.
