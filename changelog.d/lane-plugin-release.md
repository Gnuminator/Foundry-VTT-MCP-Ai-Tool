### Tooling

- **Lane kit plugin ready to install:** the built `foundry-lane-kit` plugin and its marketplace file are now committed, with install and update steps in `docs/dev/LANE-PLUGIN.md` and a refresh step in RELEASING. Its version is the tool version plus a hash of the kit, so a skill or hook change reaches every PC's `plugin update` between releases. New scripts `plugin:build`, `plugin:check` and `plugin:install-check` (I-161).
