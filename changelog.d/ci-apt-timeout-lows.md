### Fixes

- **CI:** in the Python test job the ffmpeg install now bounds each apt-get call on its own (`timeout -k 20`, 120 s for update and 180 s for install), so an apt that ignores the first signal gets a kill 20 s later. The apt network timeout also covers https mirrors.
