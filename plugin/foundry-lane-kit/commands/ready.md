---
description: Check this lane's PR against the merge gate and write the ready line, or list what is missing
---

Run `node scripts/lane-ready.mjs $ARGUMENTS` from the clean, pushed PR branch. If it prints a list of
missing things, fix them (never edit the gate) and run it again. If it prints `ready`, the
progress line is written: keep the branch pushed and stop. Message nobody.
