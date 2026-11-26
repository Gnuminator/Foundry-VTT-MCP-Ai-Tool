### Prep

- **Encounter afterglow:** every fight now records what it was planned to be (foe XP against the party's low, moderate and high budget), and `get-play-stats` gets a `fights` section: per fight the planned size, rounds, HP lost as a share of the party's max, spell slots spent, downs, and whether the cost landed in its band (low 5 to 20%, moderate 20 to 40%, high 40 to 70%). From the finished fights it works out a party toughness factor. `suggest-balanced-encounter` takes it as a new `toughness` input and scales the XP budget and creature counts by it (Backlog `encounter-afterglow`).
