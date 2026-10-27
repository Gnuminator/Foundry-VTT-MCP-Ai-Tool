# libWrapper (`lib-wrapper`)

Not verified live: drafted from the module's manifest, README, changelog, language file and settings template on disk, 2026-10-27; live check pending.

**Verdict: keep.** Version 1.13.5.1 declares Foundry 14 and `dae` (Dynamic Active Effects) requires it. Its toasts are also the fastest way to spot a module that has not been updated for Foundry 14.

**For Danni's guides:** A background helper that stops modules from fighting over the same part of Foundry; if it pops up a warning naming two modules, tell the person running the tool.

## What it does

A library for wrapping Foundry's own methods in a standard way (`libWrapper.register`, types wrapper, mixed, override and listener), with priorities, conflict detection and blame for the module involved. It adds the global `libWrapper` and fires hooks like `libWrapper.ConflictDetected`.

## Where its UI is

- Configure Settings > libWrapper: three checkboxes and a GM-only "libWrapper Settings Menu" with the tabs Priorities, Conflicts, Active Wrappers and About.
- Conflicts and errors show as toast notifications prefixed "libWrapper:", not as a dialog.

## Settings we use and why

Keys are `lib-wrapper.<key>`.

| Label (client)           | Key                     | Scope  | Default | Our value / reason                                        |
| ------------------------ | ----------------------- | ------ | ------- | --------------------------------------------------------- |
| Notify GM of issues      | `notify-issues-gm`      | world  | on      | leave on                                                  |
| Notify players of issues | `notify-issues-player`  | world  | off     | leave off: players cannot fix a module conflict           |
| High performance mode    | `high-performance-mode` | world  | off     | leave off; on removes conflict detection                  |
| Log verbosity            | `log-verbosity`         | client | warning | leave                                                     |
| (hidden)                 | `module-priorities`     | world  | `{}`    | only change in the menu if two modules are known to clash |

## How it interacts with the AI Tool

No interaction. The toasts are not stored in module errors, so `get-module-errors` is unlikely to show them (not verified live). The bridge does not use it. Only `dae` requires it among the installed modules; Sequencer uses it when present and has its own fallback otherwise.

## Gotchas on Foundry 14 / dnd5e 6

- 1.13.5.0 added the Foundry 14 compatibility entry; 1.13.5.1 only added a manifest `type` key. The manifest has no maximum core version, so Foundry will not warn about a future core; trust the `verified` field (14).
- An error toast "likely has not been updated for FVTT 14" names the module whose wrapper target moved.
- It must stay enabled while `dae` is. Foundry will not let `dae` run without it.
- It must register wrappers at or after `init`; a module that registers earlier fails (a rule for module authors).
- The overhead is per wrapped call and negligible with one dependent (not verified live).
- Nothing about dnd5e 6 or the Pi changes it.

## Sources

- Repo: https://github.com/ruipin/fvtt-lib-wrapper
- `C:\FoundryTest\data\Data\modules\lib-wrapper\module.json`, `README.md`, `CHANGELOG.md`, `lang\en.json`, `templates\settings.html`, `lib-wrapper.js` (searched, minified).
