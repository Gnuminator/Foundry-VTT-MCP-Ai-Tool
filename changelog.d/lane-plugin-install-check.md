### Process and tooling

- **Lane kit plugin install check:** `node scripts/lane-plugin-install-check.mjs` builds the `foundry-lane-kit` plugin into a temporary marketplace, installs it into a clean Claude Code profile, checks the skills, agents, `/ready` and hook scripts that landed, runs two installed guard hooks, and proves a version bump reaches the profile. It uses a throwaway profile, so nothing on the PC changes (I-161).
