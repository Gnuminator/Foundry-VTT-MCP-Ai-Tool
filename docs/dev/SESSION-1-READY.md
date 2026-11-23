---
title: Session 1 readiness checklist (live world)
description: One page to check the live Curse of Strahd world before the first live session (G1), and how to read each line without changing anything.
---

# Session 1 readiness checklist

For the live world `curse-of-strahd` on the Orange Pi, a few days before G1 and again on the day.
Every line can be read without changing the live world: pull a fresh copy with
`pwsh scripts/test-env/campaign-copy.ps1 refresh` (reads the Pi, writes nothing there), start it with
`start` (Foundry on 30004), join as `Gamemaster` in the browser pane and run the snippet in the
"Read it" column in the browser console. Fixes are made by the owner named in the line, in the live
world, never from the copy. The copy never carries the Pi's pause state (a freshly started Foundry
is always paused), so that line is checked live.

| #   | Line                                                 | Read it (copy, console)                                                                        | Ready when                                                                                           | Owner on an open line                                     |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Tarokka reading dealt or chosen                      | `game.settings.get('foundry-mcp-bridge','tarokkaTable')` is not `{}`; or `get-tarokka-reading` | A reading exists and its cards are not shown to players, or Danni has chosen to deal it at the table | Danni (decision), then Danni deals                        |
| 2   | Opening scene is in navigation and is the active one | `game.scenes.active`, its `navigation` flag, its `navName` if the name is a spoiler            | The scene the night starts on is active, navigable and has a spoiler-free navigation name            | Danni names the scene; a lane fixes a bad navigation name |
| 3   | The party is on the opening scene                    | Count tokens of the party's character actors on that scene                                     | Every player character who will play has a token on it, at full hit points, at the level agreed      | Danni (which characters play); lane for token fixes       |
| 4   | First chapter handouts queued                        | `get-player-handouts` and `get-preflight`; handout pages must have default ownership None      | Each handout for the first chapter exists, is hidden, and is listed in the prep digest               | Danni picks; a lane builds missing pages                  |
| 5   | Game unpaused when play begins                       | Live only: the pause banner in the GM's Foundry tab                                            | Danni unpauses at the start; the world is left paused until then on purpose                          | Danni, on the night                                       |
| 6   | Mood presets on, or dark on purpose                  | Setting `feature.scene-mood.enabled`; `list-scene-moods` for the opening scene                 | Switch on and a preset set on the opening scene, or Danni says "dark" and it is written in the note  | Danni (decision); lane switches it on                     |
| 7   | Switches for the night                               | **Turn on for tonight** in the dashboard Pre-flight panel                                      | Allow Write Operations, handouts, live play, party, Tarokka and GM Actions on, as in before-session  | Danni, on the night                                       |
| 8   | Pre-flight is green                                  | `get-preflight`, or the dashboard header button                                                | Every ✗ fixed, each **!** read and accepted                                                          | Whoever owns each red line                                |
| 9   | Pi and bridge are up                                 | `deploy/pi/deployed-state.ps1` (read-only)                                                     | Foundry, bridge, dashboard and recorder bot active; Plan B known ([PLAN-B.md](PLAN-B.md))            | Lane `pi-*` by name, the user for Pi changes              |

## Reading the result

Write the read-back as a note in the vault (`Handoff/Session 1 readiness <date>.md`): one row per
line, the value you read, ready or open, and the owner by name. A line is open until the live world
shows it; the copy is only a read of the Pi at the time of the refresh. Campaign and book text stay in
the world and the vault, never in this repo.
