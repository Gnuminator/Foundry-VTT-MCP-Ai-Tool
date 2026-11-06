### Fixes

- **Docs checks, announce, test server start:** the docs:ui corpus skips Storybook fixtures; a bold name written as code no longer joins two bold runs; the announce settings trim each source before the file fallback; `tools/session-notes/auto.ps1` accepts `FVTT_VOICE_STACK` so its test can prove the fake transcriber ran; the test server's world "verified" bump now runs after the data-folder lock wait, writes `world.json` atomically, leaves `coreVersion` alone and warns when it cannot read the compatibility block.
