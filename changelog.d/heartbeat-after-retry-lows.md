### Fixes

- **Module link follow-ups:** a normal start no longer starts the heartbeat twice, a late link-up always marks the link connected, the first-connect warning says the bridge keeps dialling unless auto-reconnect is off, and stopping the bridge while it is still connecting no longer blocks the next start until Foundry reloads (Backlog `heartbeat-after-retry-lows`).
