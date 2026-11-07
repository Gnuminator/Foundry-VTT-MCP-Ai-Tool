### Module (module-plain-errors)

- **Error pop-ups in plain words:** when something fails in Foundry (opening a window, a roll button, the campaign progress toggles, the creature index build, starting the AI Tool) the GM now sees "Could not ...", a short reason and what to try, not a raw error string. The detail stays in the browser console.
- **One name for the creature index:** menus, pop-ups and the settings window all say "creature index" now.
- **No silent confirm windows:** the handouts and AI changes windows say so when Foundry cannot show their confirmation dialog, instead of doing nothing.
- **Manifest:** `module.json` has a plainer description and says the module needs the dnd5e system (version 6 or newer).
- **Dead settings code removed:** the unused `lastConnectionState`, `lastActivity` and `lastMCPServerNotification` settings, `resetToDefaults` and the empty `migrateSettings` are gone.
