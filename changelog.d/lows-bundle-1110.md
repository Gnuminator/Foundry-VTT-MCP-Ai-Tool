### Docs

- **GM setup pages:** the Syncthing page says the yellow bar may show a device ID instead of foundry-pi and how to check it is the server; the Obsidian plugin page says the Cloudflare values go only to an https address; the dashboard page explains the GM token link when GM buttons are refused (Backlog `gm-setup-lows`).
- **Actor Studio in the foundry-modules skill:** the version table and the reference page name `2.10.5-aitool.12` and its edition filter, and say the Pi stays on `.10` until stage 13 runs again (Backlog `skill-studio-version`, `studio-skill-version-5`).

### Tests

- **Weekly pace:** a measured profile now runs through `paceFor`, `usage:week --json` and `usage:now`; the idle-weekend test asserts the weekend share; `usage:now` takes the week start from one helper, `weekStartFor`; the usage log zone assumption is commented (Backlog `pace-lows`).
