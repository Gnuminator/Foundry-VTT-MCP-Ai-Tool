### Fixes

- **Plan B restore installs Foundry on a fresh root:** Windows `tar.exe` cannot create the
  `node_modules/.bin` links in the Foundry zip and exited 1, so `restore.ps1` threw before it wrote
  its state. It now tolerates complaints that name a `.bin` path (the app never uses them on
  Windows), warns how many it skipped, and still fails on any other unpack error.
