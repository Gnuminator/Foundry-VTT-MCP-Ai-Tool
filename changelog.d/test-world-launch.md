### Test environment

- **Test worlds launch again after a Foundry point update:** Foundry refuses to auto-launch a world
  whose verified build is older than the running Foundry ("requested World ... is not available to
  auto-launch"); `coreVersion` does not matter. `start.ps1 -World <id>` (so `kit:run`) now brings
  the world's `compatibility.verified` and `coreVersion` up to the app's build before it starts
  Foundry, on all three servers, and keeps a `world.json.bak-verified` copy.
