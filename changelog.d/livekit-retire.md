### Fixes

- **The old LiveKit voice stack is removed:** `tools/livekit` (server, egress, recorder) and the `livekit` and `tls` profiles of `voice-stack.ps1` are gone, together with their CI steps and the recorder's dependency check. Game nights are recorded by the Discord bot; `voice-stack.ps1 transcribe` and `names` work as before, and the transcriber still reads a LiveKit-named recording folder if you have one. Git history keeps the old files.
