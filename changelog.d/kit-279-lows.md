### Test kit

- **#279 review lows:** the wait after a new item re-reads the actor's species on every check, so
  a species replaced mid-wait must link too; `createHero` says plainly when gm.mjs did not send
  its `settleCreated` helper instead of failing on `undefined`.
