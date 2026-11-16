Backlog: `id`

<!-- Backlog: closes the item at merge. A PR that is one part of an item that stays open uses `Backlog-part: id` instead. -->

## What changed

## How it was verified

Commands, kit report with its `run.gitSha`.

Live check: <!-- Only for PRs that touch packages/foundry-module/src/ or scripts/pi/remote/ (the merge gate refuses them without this line; delete the line otherwise).
Module: the run on test server A with real dnd5e data.
Pi: the ARM64 container run plus the read-only deploy/pi/deployed-state.ps1 check of the host assumptions.
Or say why there was none. -->

## Open and follow-ups
