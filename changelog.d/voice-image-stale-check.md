### Fixes

- **Voice images rebuild when they are older than the code:** the transcriber and session-pipeline images now carry a hash of their source folder. `voice-stack.ps1 transcribe` compares it with the checkout and rebuilds a stale image before the job (or stops with one line under `-NoRebuild`), so a recording is never transcribed with an old model default again.
