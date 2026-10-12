### Dashboard

- **The combat strip in the new dashboard:** the turn order is in the During view's strip slot, as
  in the full dashboard. It has one row per combatant in the order Foundry sends them, with the
  initiative, name, PC, Enemy or NPC tag, conditions, death saves and hit points with a bar. It
  shows while a fight runs (and in Full), and the layouts place it as before. The layout trial's
  Auto step shows its sample fight there too.
- **Damage, Heal and Condition from the strip:** with Combat buttons and GM Actions on, click
  combatants to pick them and use Damage / Heal or Condition. Each opens the Tool runner on
  `plan-actor-change` with the picked names filled in. Nothing is changed from the strip itself:
  you press Run there and confirm as for any guarded change. The full dashboard applies a
  one-click change straight away; the new one asks first.
- **Boss prompts fixed:** the reaction button (R) now shows only on a boss that is still standing
  (one with legendary actions or a lair), and only while Boss prompts is on. The Boss prompts
  switch shows whenever it is on or a boss is in the fight, so it can always be turned off. In the
  full dashboard a switch left on gave every combatant an R button in later fights, with no way
  to turn it off.
- **A fight is marked old when the bridge is away:** the strip keeps the rows and says "The bridge
  is away: this is the fight as last seen." The rows are dimmed and the action bar and R buttons
  are switched off until the bridge is back.
- **Conditions show in every layout:** the full dashboard hides the condition chips in the strip
  except in Auto during a fight. The new dashboard shows them in Cards and Simple/Full too.
- **Keyboard and screen readers:** rows can be picked with Tab and Enter or Space, and say whether
  they are picked. Each R button has a name ("Reaction ready: Name" or "Reaction used: Name") and
  a state, and ticking it no longer moves the keyboard focus. The hit point bar and death saves
  are also written out in words. A fight with nobody in it says so.
