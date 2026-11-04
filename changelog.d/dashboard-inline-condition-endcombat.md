### Dashboard

- **Condition and End combat work inline on the combat strip:** Condition opens a row of condition
  chips under the action bar; a chip plans it with `plan-actor-change`, one plain confirm asks
  ("Set prone on Brannoc and Mira?"), and it applies with Undo on the toast and in Recent Changes.
  End combat plans with `plan-combat-change`, asks one plain question and applies, the same flow
  as the live strip's End combat (now one shared helper, `lib/endCombat.ts`). Neither opens the
  Tool Runner any more. GM Actions and live play gate them exactly as before.
