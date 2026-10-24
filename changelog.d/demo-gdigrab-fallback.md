### Fixes

- **Demo recorder fallback:** `FOUNDRY_DEMO_GRAB=gdigrab` makes `demo:take --recorder ffmpeg` capture with gdigrab instead of ddagrab, for a night when ddagrab opens the screen but never delivers a frame (video-voice lane).
