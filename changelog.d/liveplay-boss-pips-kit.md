### Test kit

- **The kit checks that the boss pips follow Foundry:** the dashboard control sweep spends a legendary action on the boss in Foundry (the boss's own legendary activity, used the way the table uses it), waits for the Legendary pips on the dashboard to drop by one, puts the pool back and waits for the pips to return. New GM actions `spendLegendary` and `restoreLegendary`; the fake combat state now reports a monster's boss resources too.
