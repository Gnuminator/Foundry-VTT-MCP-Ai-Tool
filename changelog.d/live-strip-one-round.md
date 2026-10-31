### Dashboard

- **"1 round" on the live strip's condition picker:** a toggle in front of the conditions; with it
  on, the next condition added lasts one round (`rounds: 1` through the planned change). The
  condition chip then says how long it has left ("Prone, 1 round") and "Poisoned, ended" once the
  time is up, with a hint to click the condition again to put it back. An ended timed condition
  used to look like a plain one.

### Module

- **Timed conditions in the combat state:** each combatant carries `timed`, the rounds left on its
  timed condition effects by name (0 once the time is up).
