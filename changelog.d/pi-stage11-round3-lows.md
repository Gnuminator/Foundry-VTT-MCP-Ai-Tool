### Pi setup (stage 11, round 3 review of PR #294)

- **A kit world is only reset if it is a kit copy of the same world:** stage 11 now marks each kit world it
  makes (`flags["foundry-ai-tool"].kitOf` in `world.json`) and stops before anything changes when
  `KIT_WORLD` names an installed world without that marker for this `WORLD`, so a campaign run can no longer
  overwrite the Frostmaiden training world. The Pi's older `strahd-kit` is accepted for the Strahd campaign
  and gets the marker on its next run. `REPLACE_KIT=1` allows the replacement on purpose.
- **Suffix-only module versions are compared:** `2.10.5-aitool.4` against `2.10.5-aitool.5` now compares the
  counter instead of staying unsure, so an older Pi copy of a `-PiModules` module is refused and a newer one
  is accepted.
- **Clearer messages:** the stage 11 header describes how modules are handled now (a push-back keeps newer Pi
  copies, a second world's modules need `SHIP_MODULES=1`), the older-module refusal says where to update, and
  the `-PiModules` example in `push-world.ps1` uses `-Modules ''`.
- **Old Assistant GM driver is refused:** stage 11 now stops before anything changes when an extra GM is
  involved (`EXTRA_GM_USER`, or a world's env file that names one) and the installed stage 5 driver predates
  the extra GM, which it would silently ignore. Run stage 5 again first.
