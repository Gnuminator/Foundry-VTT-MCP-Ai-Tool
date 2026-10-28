### Pi

- **GitHub Actions runners on the Pi (stage 17):** two self-hosted runners for the PM board's workflows
  (obsidian-vault and the board repo), so board builds no longer use GitHub's free hosted minutes. They run as
  their own user with no access to the game's files or ports, and a gate timer keeps them stopped while a play
  session is marked (builds wait and run afterwards). A PC helper hands over the one-hour registration token
  without printing it (board-local-deploy).
