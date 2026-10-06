### Fixes

- **Assistant GM browser runs at low priority on the Pi (I-098):** the `foundry-ai-tool-gm-browser`
  service now has `Nice=10` and `CPUWeight=20`, so its headless Chromium never competes with
  Foundry's main thread on game night. It takes effect when stage 5 is next rerun on the Pi.
