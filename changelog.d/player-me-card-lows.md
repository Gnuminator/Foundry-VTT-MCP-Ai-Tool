### Player connector

- **The /me connector card:** a failed copy of the Client Secret now says "Press Show, then select the value and copy it" instead of Ctrl+C on a hidden field, the error opens the card so it is announced, and the muted hints and labels are darker in the paper views.
- **Extension 0.1.5:** the re-initialize after a lost session waits at most as long as the first one (it could take 70 s). The planner replaces `foundry-player.mcpb` on the release after this merge.
- **Config logging:** the second startup warning says the team domain is "not set or does not parse", and the dropped-entry warnings repeat when the same file comes back after an unreadable spell.
