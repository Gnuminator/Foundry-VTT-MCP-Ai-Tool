### Reliability

- **The bridge log survives restarts and says when the link drops:** the Pi bridge now logs at info into `/var/lib/foundry-ai-tool/logs/mcp-server.log` (set by stage 5, `LOG_LEVEL` and `LOG_FILE_PATH`; `bridge.env` can override) instead of a private temp folder that vanished at every restart. The file log rotates (5 files of 5 MB). The link-down warning now comes after 30 seconds instead of 5 minutes, and link-up is a warning that carries the outage length. The module writes one console line when the bridge link goes up or down, even with debug logging off.
