### Process

- **Planner texts match the merge runner:** the planner skill reads state with `backlog.mjs status --planner` and is shorter (word budget 1,190 to 1,169); the "no standing planner" test also fails if the skill brings back `gh pr list` or drops `--planner`.
