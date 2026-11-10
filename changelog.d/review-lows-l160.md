### Tooling

- **Review lows from PRs 810, 817 and 820:** the shape capture script skips `flags` at any depth, folds every 16-character key into an id except a short list of real field names, and names kinds with fewer than three samples. The Foundry mock's type pins also check the fake. `UPDATE_FIXTURES` writes the change-list fixture in prettier's layout. The wrapper log roll no longer replaces a log another Desktop connector has just rolled (a unit test covers it). The ARCHITECTURE control-method list is in one place, and the foundry-ai-tool skill names the bridge's default log file.
