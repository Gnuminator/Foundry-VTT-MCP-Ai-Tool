### Build

- **Create a player character:** the new `plan-pc-creation` tool (Build set) plans a character actor with a name, an owner and items copied from compendium packs by uuid, with equipped, prepared and stack size set; a container such as a backpack brings its contents. Apply it with `apply-planned-change`, undo it with `undo-change`. It sits behind the new "Character creation" switch, and class advancement does not run (add the granted features by uuid) (Backlog `pc-creation-tool`).
