### Orange Pi (D-068)

- **Stage 11 takes a second world (D-118):** `LAUNCH` may name a world that is already installed, so
  the Frostmaiden training world goes in while Foundry keeps launching the campaign. `EXTRA_GM_USER`
  adds a second full GM with its own generated password to the world's env file, once; another name
  already in the file, or one equal to the world's GM or the Assistant GM, stops the run before
  anything changes. The `strahd-kit` test copy is the default only for `curse-of-strahd`: any other
  world must set `KIT_WORLD`. The push-back module check keeps the Pi's copy when the numbers match
  but a pre-release suffix differs (1.2.0 and 1.2.0-rc1), and the summary masks module versions.
  Stage 13 follows the same `KIT_WORLD` rule.
  `push-world.ps1 -PiModules` names modules the Pi already has so a second world does not ship them
  again; stage 11 refuses the bundle if one is missing on the Pi or is also in the bundle.
