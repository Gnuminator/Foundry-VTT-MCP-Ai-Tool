### Bridge (I-109 part 3)

- **Undo for everything:** Claude can now undo anyone's change with the new `plan-undo-changes` tool: just that one (what changed after it stays, numbers are adjusted by that change's part), or everything since on the same thing, or a rewind of the whole table. Apply the plan with `apply-planned-change`. Undoing that change again is the redo, and an AI undo can be undone too. What is undone is worked out from the audit log, so a redo brings the original change back. The new switch "AI Tool: Undo for everything" is on by default.
