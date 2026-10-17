### Fixes

- **Combat strip on a duplicated scene:** Foundry keeps token ids when a scene is copied, so a strip
  pick on scene A could land on the token of a viewed copy. The live plan now refuses an id that is a
  different token in the fight than on the viewed scene, names both scenes, and says to view the
  fight's scene to hit its token, or to name the token to hit the one on the viewed scene.
  (Backlog: strip-pick; #343 review L2)
