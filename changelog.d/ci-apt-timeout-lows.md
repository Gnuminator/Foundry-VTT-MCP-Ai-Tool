### Fixes

- **CI:** the bounded ffmpeg install in the Python test job now follows `timeout` with a kill after 20 s (`timeout -k 20 300`), so an apt that ignores the first signal is stopped inside the install step instead of failing the job at its limit. The apt network timeout also covers https mirrors.
