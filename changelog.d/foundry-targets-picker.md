### Dashboard

- **Use Foundry targets:** the combat strip has a "Use Foundry targets" button that picks the
  combatants you have targeted (or, with none targeted, selected) in Foundry, so Damage / Heal and
  "Ask picked" follow them. Token and actor fields in the Tool runner (group saves, roll requests)
  have the same button beside Pick.

### Module

- `get-targets` also returns `selected`, the tokens selected on the canvas, in the same shape as
  `targets`. It also reads the targets of the other active GMs when the bridge user has none, so it
  works when the bridge runs in another GM's browser showing the same scene (Foundry only syncs
  targets then); `selected` is local to the bridge's browser
  and only reflects the GM when the bridge runs in the GM's own.
