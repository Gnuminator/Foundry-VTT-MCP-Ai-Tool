### Orange Pi

- **Assistant GM hang watchdog:** the headless Assistant GM browser now pings its own page every 15 seconds and restarts when the page has not answered for 90 seconds, even while the module socket is up (a frozen page keeps its socket, so the 2 minute no-socket check never saw it). It shares the link check's cap of three restarts in six hours and can be switched off with `GM_PAGE_WATCH=0`. New Pi stage 28 (`28-gm-watchdog.sh`) installs the new driver with a backup, an undo and a read-back; tested with a frozen page in the ARM64 container test.
