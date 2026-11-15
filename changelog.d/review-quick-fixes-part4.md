### Fixes

- **Transcription always uses the model it says it uses:** `voice-stack.ps1 transcribe` now passes `--model large-v3` itself. The transcriber image bakes in its default at build time, and the image on the main PC was older than the large-v3 default, so the 2026-10-29 session ran on large-v3-turbo without anyone choosing it (review-quick-fixes).
