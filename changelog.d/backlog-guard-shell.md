### Process

- **Backlog guard closes two shell gaps:** a lane's `python` or `node` one-liner that opens `Backlog.md` for writing, and a `git commit -a`, `git add -A`, `git add .` or `git add <directory>` in the vault (which would take `Backlog.md` along), are refused with the `backlog.mjs` command. Naming other files (`git add Waiting.md`) stays allowed (Backlog `backlog-guard-shell`).
