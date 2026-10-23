### Module

- **NPC turn review lows (PR #464):** two tokens of one linked actor hit in one plan now give one hit point change instead of two that overwrite each other; a plan with more than one legendary action is refused (one at a time, at the end of another creature's turn); a normal attack planned on another creature's turn gets a note; the `damageWith` hints and the `results` description ask for one entry per `damageByType` entry; tests for activities, the per-type damage sum and the old-module guards.
