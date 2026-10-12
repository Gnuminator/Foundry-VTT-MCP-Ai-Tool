### Fixes

- **Changes window: Undo works on a reveal:** a Tarokka or handout reveal (a change that also wrote the AI Tool's own data) was offered Undo in the Changes window but refused with "undo it with undo-change". The window now asks for the usual confirm and undoes it with the plain undo, which puts the vault back and refuses on a conflict. The refusal that Claude's planned undo still gives for such a change now names the Changes window and the dashboard's Recent Changes as ways to undo it. The test kit's control sweep now requires the window to undo both reveals.
- **Dashboard Recent Changes, Everyone tab:** the same reveal rows now undo with the plain undo (after the tab's confirm) instead of the planned undo's refusal.
