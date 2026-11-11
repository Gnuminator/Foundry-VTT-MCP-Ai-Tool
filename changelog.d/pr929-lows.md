### Dashboard

- **Attack form polish:** the weapons list no longer waits for the spell read, and when spells cannot
  be read the form says "Spells could not be read." instead of staying silent. The weapon list also
  skips an item marked `hasAttack: false` (the module does not send that yet), and the empty button reads "Pick a weapon or spell"
  (backlog item pr929-lows).
