### Play log

- **The session log marks its gaps:** when the link to Foundry was down for more than 15 seconds, Foundry was reloaded (the module's event counter went back), or more events arrived between two reads than the module's buffer holds, the pumps write a visible `pump-gap` line into the session log in plain words ("Recording gap ... Foundry was reloaded, so some events may be missing"). The play log pump also counts the records it knows were lost. Gap lines never count as table activity for the play session.
- **Pump health in the pre-flight:** `get-preflight` has a "Session and play log recording" line: last read, last error, since when nothing is being recorded, gaps and lost records since the backend started. Unknown before the first read, never a plain OK without one.
