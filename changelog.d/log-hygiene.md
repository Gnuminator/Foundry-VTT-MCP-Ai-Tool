### Orange Pi

- **Fewer secrets in logs:** at `LOG_LEVEL=debug` the backend now cuts each query payload to 500 characters and prints a warning at startup that the log may hold chat and GM notes. The Pi's SSH log (stage 9) no longer keeps the command text of token scripts (`no-log`, tunnel, dashboard access, Discord token and the runner token file); the Discord bot prints an error's message instead of dumping the object. Takes effect on the Pi at the next stage 9 and bot deploy (Backlog: log-hygiene).
