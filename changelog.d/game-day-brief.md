### Docs

- **Game-day brief:** a read-only scheduled Claude task that runs the pre-flight check and the prep digest and sends one push line to the tool admin, set to run two hours before a game night; it uses no write tool and no paid API. The task definition and install note ship in `deploy/scheduled-tasks/game-day-brief/`, a test keeps it to the two read tools, and the game night runbook mentions it (I-162).
