### Foundry setup (D-135)

- **Module toggles, review fixes:** the undo of a first switch-on from the Changes list is checked against the modules that need it, the dependency walk goes down for turning on and up for turning off (the target row is never cut by the 400 row cap), and a missing dependency row stops the plan instead of being skipped. The read and the apply both judge on or off from the module configuration first, a requirement on the game system is never taken for a module, and the chain below a module the world or system needs is marked as forced on.
- **One undo rule for roles:** undoing a role lowering always works, from the Changes list and from undo-change alike (a redo is still gated by the setup switch).
- **Clearer refusals:** two documents with one name list name and id, a Gamemaster or Assistant GM refusal says both, a module list that grows past the limit after the plan is named, and the server refuses a module or ownership read from an older module.
