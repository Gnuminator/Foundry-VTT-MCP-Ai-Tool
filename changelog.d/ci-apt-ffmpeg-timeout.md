### Fixes

- **CI python-tests can no longer hang on a slow apt mirror:** the ffmpeg install is bounded (5 minutes, short per-download timeouts) and a failure only skips the narration render tests with a warning; the job also has a 20 minute limit.
