### Orange Pi (D-068)

- **Kit session (strahd-kit test run):** a new reviewed Pi script, `kit-session.sh`, sets up the throwaway world
  `strahd-kit` so a player can make a level-1 character in Actor Studio as the passwordless user `Kit Player`
  (`MODE=up`), and afterwards deletes that user and the actors it owns and puts Foundry, `options.json` and the
  Assistant GM browser back (`MODE=down`). It never touches `curse-of-strahd`, keeps copies of the world's settings,
  users and actors, and undoes itself if anything fails. Tests: `scripts/pi/kit-session.test.mjs`, with an ARM64
  container run like stage 13's.
