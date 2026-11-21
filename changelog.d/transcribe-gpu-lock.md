### Fixes

- **Transcription and the Previously on voice take the GPU lock:** `voice-stack.ps1 transcribe` and the dashboard's Previously on narration hold the GPU lock while they run and release it afterwards, also on failure. If another GPU job holds it, they stop with a plain message naming the holder instead of starting on top of it.
