### Module (I-109 part 4)

- **The "AI changes" window is now "Changes":** it lists everyone's changes (players, the GM and the AI) from the last week, with who made each one, a "Show: All / AI / each person" filter, and **Undo** on any change that can still be undone. The scene-control button is renamed too (its internal name is unchanged).
- **Undo asks the right question:** it plans the undo and shows what will be put back before you confirm. When a later change touched the same thing, the window lists those changes and offers **Just this**, **Everything since** or **Cancel**; under **Advanced** a **Rewind the whole table to here** asks twice (the full list and count, then a button that names the count) before it applies.
- **Redo:** a change that was undone shows "undone by NAME" and gets **Redo** when the undo can itself be taken back.
- **Older bridge:** without `list-changes` the window falls back to the AI-only list and the plain undo, with no filter or Redo.

### Bridge (I-109 part 4)

- **Module requests:** `list-changes` and `plan-undo-changes` join `MODULE_REQUEST_TOOLS`. `plan-undo-changes` is a module planner (feature `change-undo`, any scope, only `id`, `scope` and `rewindTable`), so a window can apply only an undo plan it made itself. The bridge hello lists the two new `module-request:<tool>` capabilities.
- **Undo plans say how many:** `plan-undo-changes` answers with a `count` of the changes the plan undoes.
