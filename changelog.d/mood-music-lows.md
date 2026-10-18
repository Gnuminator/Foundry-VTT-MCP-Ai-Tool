### Scene mood and music (follow-up to PR #406)

- **One track at a time:** `play` or `switch` on a sequential or shuffle playlist that is already on
  a later track keeps that track instead of starting the first one as a second track.
- **Refused while planning:** soundboard-mode playlists (they cannot play as a whole) and weather
  ids Foundry does not know (the reply lists the valid ones).
- **Undo note:** the `plan-scene-mood` text now says music undo is refused once a playlist has moved
  on to its next track by itself.
