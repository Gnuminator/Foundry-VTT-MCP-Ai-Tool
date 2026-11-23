### Process

- **`/ready` names the fix for a drift refusal:** when the drift check would refuse the head, `lane-ready.mjs` lists each failing guard with the exact command to run (`docs:tools`, the line, lint and em-dash baseline updates), and runs the drift check itself when the gate skipped it because something else failed first. No ready line is written until it passes.
