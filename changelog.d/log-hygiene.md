### Orange Pi

- **Fewer secrets in logs:** at `LOG_LEVEL=debug` the backend now cuts each query payload to 500 characters and prints a warning at startup that the log may hold chat and GM notes. The Pi's SSH log (stage 9) logs the exact commands of the token scripts (Discord token, tunnel, dashboard access, runner token file) by kind without their text; every other command keeps its text. The Discord bot prints an error's message instead of dumping the object. Takes effect on the Pi at the next stage 9 and bot deploy (Backlog: log-hygiene).
