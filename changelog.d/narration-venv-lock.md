### Fixes

- **Narration voice environment is frozen:** `tools/narration/requirements-voice.lock.txt` pins the working voice venv (exact versions, cu128 torch); the README installs from it and a test keeps both in step.
