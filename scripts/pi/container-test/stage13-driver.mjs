// Stand-in for player-creation-settings.mjs (there is no Foundry or Chromium in the container): prints
// what stage 13 hands it, never the password itself.
console.log(
  `DRIVER HOME=${process.env.HOME} TOOL_APP=${process.env.TOOL_APP} WORLD=${process.env.WORLD} HAS_PW=${(process.env.GM_PASSWORD || '') !== ''}`
);
