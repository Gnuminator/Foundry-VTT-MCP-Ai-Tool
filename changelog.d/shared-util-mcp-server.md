### Fixes

- **Shared helpers in the MCP server:** the scene tools and the connection retry now use the one shared `errorMessage` and `sleep` instead of their own copies (Backlog item shared-util-dedupe). An error that is not an Error object now shows its text in a scene error instead of "Unknown error".
